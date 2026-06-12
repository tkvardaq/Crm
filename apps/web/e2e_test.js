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
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return false;
}

(async () => {
  const results = [];

  function log(pass, msg) {
    const icon = pass ? '✅' : '❌';
    console.log(`${icon} ${msg}`);
    results.push({ pass, msg });
  }

  async function screenshot(name) {
    try {
      const screenshotPath = path.join(tmpDir, `e2e_${name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(` 📸 Screenshot: ${screenshotPath}`);
    } catch (e) {
      console.log(` 📸 Screenshot failed: ${e.message}`);
    }
  }

  console.log('[SETUP] Cleaning up any existing servers on port 3002...');
  try {
    execSync(
      'powershell -Command "Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"',
      { windowsHide: true, stdio: 'ignore' }
    );
    console.log('[SETUP] Cleanup done, waiting 2s...');
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) { /* ignore */ }

  console.log('[SETUP] Starting Next.js dev server on port 3002...');
  let serverPid = null;
  try {
    const psScriptPath = path.join(tmpDir, 'start_dev_server.ps1');
    const projectDir = path.resolve(__dirname);
    const psContent = `Set-Location -LiteralPath "${projectDir}"\n$env:PORT=3002\n$proc = Start-Process -FilePath "npm" -ArgumentList "run","dev" -PassThru -NoNewWindow\nWrite-Output "SERVER_STARTED:$($proc.Id)"\n`;
    require('fs').writeFileSync(psScriptPath, psContent);
    const out = execSync(
      `powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`,
      { windowsHide: true }
    );
    const match = out.toString().match(/SERVER_STARTED:(\d+)/);
    if (match && match[1] !== '0') {
      serverPid = parseInt(match[1]);
      console.log('[SETUP] Server npm PID:', serverPid);
    }
  } catch (e) {
    console.log('[SETUP] Launch warning: ' + e.message);
  }

  const ready = await waitForServer('http://localhost:3002/api/auth/csrf', 30000);
  if (!ready) { console.error('[SETUP] Server failed to start!'); process.exit(1); }
  console.log('[SETUP] Server ready on http://localhost:3002');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('\n--- Test 1: Login Page ---');
    await page.goto('http://localhost:3002/login', { waitUntil: 'networkidle', timeout: 15000 });
    const title = await page.title();
    log(title === 'CRM Tool', `Login page title: ${title}`);

    const emailInput = await page.locator('input[type="email"]').count();
    log(emailInput > 0, 'Email input found');

    const passwordInput = await page.locator('input[type="password"]').count();
    log(passwordInput > 0, 'Password input found');

    const submitBtn = await page.locator('button[type="submit"]').count();
    log(submitBtn > 0, 'Submit button found');

    await screenshot('login_page');

    console.log('\n--- Test 2: Login Flow ---');
    await page.fill('input[type="email"]', 'admin@acme.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    try {
      await page.waitForURL('**/((dashboard|pipeline|leads))**', { timeout: 10000 });
      log(true, `Redirected to: ${page.url()}`);
    } catch (e) {
      log(false, `Login redirect failed, URL: ${page.url()}`);
    }

    await screenshot('after_login');

    console.log('\n--- Test 3: Pipeline Page ---');
    await page.goto('http://localhost:3002/pipeline', { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot('pipeline_page');

    const stageColumns = await page.locator('[data-stage-id], .stage-column, [class*="stage"]').count();
    log(stageColumns > 0, `Pipeline stage columns found: ${stageColumns}`);

    const pageContent = await page.textContent('body');
    log(pageContent.includes('Pipeline') || pageContent.includes('Stage') || stageColumns > 0, 'Pipeline page has content');

    console.log('\n--- Test 4: Leads Page ---');
    await page.goto('http://localhost:3002/leads', { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot('leads_page');

    const leadsContent = await page.textContent('body');
    log(leadsContent.includes('Lead') || leadsContent.includes('Email') || leadsContent.includes('leads'), 'Leads page has content');

    console.log('\n--- Test 5: Campaigns Page ---');
    await page.goto('http://localhost:3002/campaigns', { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot('campaigns_page');

    const campaignsContent = await page.textContent('body');
    log(campaignsContent.includes('Campaign') || campaignsContent.includes('campaign'), 'Campaigns page has content');

    console.log('\n--- Test 6: Inbox Page ---');
    await page.goto('http://localhost:3002/inbox', { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot('inbox_page');

    const inboxContent = await page.textContent('body');
    log(inboxContent.includes('Inbox') || inboxContent.includes('Email') || inboxContent.includes('inbox'), 'Inbox page has content');

    console.log('\n--- Test 7: Settings Page ---');
    await page.goto('http://localhost:3002/settings', { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot('settings_page');

    const settingsContent = await page.textContent('body');
    log(settingsContent.includes('Settings') || settingsContent.includes('Domain') || settingsContent.includes('settings'), 'Settings page has content');

    console.log('\n--- Test 8: Register Page ---');
    await page.goto('http://localhost:3002/register', { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot('register_page');

    const registerForm = await page.locator('form').count();
    log(registerForm > 0, 'Register form found');

  } catch (err) {
    console.log(`\n❌ TEST ERROR: ${err.message}`);
    await screenshot('error_state');
  }

  await browser.close();

  try {
    execSync('powershell -Command "Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"', {
      stdio: 'ignore',
      windowsHide: true
    });
    console.log('[CLEANUP] Server stopped');
  } catch (e) {
    console.log('[CLEANUP] Server kill: ' + e.message);
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
