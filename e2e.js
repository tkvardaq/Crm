const { chromium } = require('playwright');
const { execSync } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const tmpDir = os.tmpdir();

async function waitForServer(url, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, r => { r.on('data', () => {}); r.on('end', resolve); });
        req.on('error', reject);
        req.socket.on('error', reject);
        req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 2000));
      process.stdout.write('.');
    }
  }
  return false;
}

function killPort3002() {
  try {
    execSync('cmd /c for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3002 ^| findstr LISTENING\') do taskkill /F /PID %a', { stdio: 'ignore', windowsHide: true });
  } catch {}
}

function startServer() {
  try {
    const projectDir = path.resolve(__dirname, 'apps', 'web');
    execSync(`cmd /c start /b cmd /c cd /d "${projectDir}" && set PORT=3002 && npm run dev`, { stdio: 'ignore', detached: false, windowsHide: true });
  } catch (e) {
    console.log('start warning: ' + e.message);
  }
}

(async () => {
  const results = [];

  function log(cond, msg) {
    console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg);
    results.push(cond);
  }

  async function screenshot(name) {
    try {
      const screenshotPath = path.join(tmpDir, 'e2e_' + name + '.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(' Screenshot: e2e_' + name + '.png');
    } catch {}
  }

  console.log('[1/4] Cleaning up port 3002...');
  killPort3002();
  await new Promise(r => setTimeout(r, 2000));

  console.log('[2/4] Starting Next.js dev server...');
  startServer();

  console.log('[3/4] Waiting for server...');
  process.stdout.write(' Waiting');
  const ready = await waitForServer('http://localhost:3002/api/auth/csrf', 45000);
  console.log('');
  if (!ready) {
    console.error('Server failed to start!');
    killPort3002();
    process.exit(1);
  }
  console.log(' Server ready on http://localhost:3002');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('\n--- Login Page ---');
    await page.goto('http://localhost:3002/login', { waitUntil: 'networkidle', timeout: 15000 });
    log(await page.title() === 'CRM Tool', 'Title is "CRM Tool"');
    log(await page.locator('input[type="email"]').count() > 0, 'Email input present');
    log(await page.locator('input[type="password"]').count() > 0, 'Password input present');
    log(await page.locator('button[type="submit"]').count() > 0, 'Submit button present');
    await screenshot('login');

    console.log('\n--- Login Flow ---');
    await page.fill('input[type="email"]', 'admin@acme.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);
    const postLoginUrl = page.url();
    log(postLoginUrl.includes('3002'), 'Redirected to app: ' + postLoginUrl);
    await screenshot('after_login');

    console.log('\n--- Pipeline Page ---');
    await page.goto('http://localhost:3002/pipeline', { waitUntil: 'networkidle', timeout: 15000 });
    const pipelineText = await page.textContent('body');
    log(pipelineText.length > 100, 'Pipeline page has content (' + pipelineText.length + ' chars)');
    await screenshot('pipeline');

    console.log('\n--- Leads Page ---');
    await page.goto('http://localhost:3002/leads', { waitUntil: 'networkidle', timeout: 15000 });
    const leadsText = await page.textContent('body');
    log(leadsText.length > 100, 'Leads page has content (' + leadsText.length + ' chars)');
    await screenshot('leads');

    console.log('\n--- Campaigns Page ---');
    await page.goto('http://localhost:3002/campaigns', { waitUntil: 'networkidle', timeout: 15000 });
    const campText = await page.textContent('body');
    log(campText.length > 100, 'Campaigns page has content (' + campText.length + ' chars)');
    await screenshot('campaigns');

    console.log('\n--- Inbox Page ---');
    await page.goto('http://localhost:3002/inbox', { waitUntil: 'networkidle', timeout: 15000 });
    const inboxText = await page.textContent('body');
    log(inboxText.length > 100, 'Inbox page has content (' + inboxText.length + ' chars)');
    await screenshot('inbox');

    console.log('\n--- Settings Page ---');
    await page.goto('http://localhost:3002/settings', { waitUntil: 'networkidle', timeout: 15000 });
    const settingsText = await page.textContent('body');
    log(settingsText.length > 100, 'Settings page has content (' + settingsText.length + ' chars)');
    await screenshot('settings');

    console.log('\n--- Register Page ---');
    await page.goto('http://localhost:3002/register', { waitUntil: 'networkidle', timeout: 15000 });
    log(await page.locator('form').count() > 0, 'Register form present');
    await screenshot('register');

  } catch (e) {
    console.error('\nTEST ERROR: ' + e.message);
    await screenshot('error');
  }

  await browser.close();

  console.log('\n[4/4] Cleaning up...');
  killPort3002();

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log('\n=== RESULTS: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
})();
