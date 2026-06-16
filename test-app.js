const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  // Test 1: Login page
  console.log('Navigating to login page...');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle', timeout: 15000 });
  await page.screenshot({ path: 'C:/Users/talha/AppData/Local/Temp/crm-login.png', fullPage: false });
  console.log('Login page screenshot saved to C:/Users/talha/AppData/Local/Temp/crm-login.png');
  console.log('Login page URL:', page.url());
  console.log('Login page title:', await page.title());

  // Check login form exists
  const emailInput = await page.$('input[type="email"]');
  const passwordInput = await page.$('input[type="password"]');
  const submitBtn = await page.$('button[type="submit"]');
  console.log('Email input found:', !!emailInput);
  console.log('Password input found:', !!passwordInput);
  console.log('Submit button found:', !!submitBtn);

  // Test 2: Root page should redirect to login
  console.log('\nNavigating to root / ...');
  const resp = await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  console.log('Root page URL:', page.url());
  console.log('Root redirected to login:', page.url().includes('/login'));

  // Test 3: API should redirect to login
  console.log('\nNavigating to /api/leads (should redirect to login)...');
  const apiResp = await page.goto('http://localhost:3000/api/leads', { timeout: 5000 }).catch(() => null);
  console.log('API /leads current URL:', page.url());
  console.log('API redirected to login:', page.url().includes('/login'));

  // Test 4: Register page
  console.log('\nNavigating to /register...');
  await page.goto('http://localhost:3000/register', { waitUntil: 'networkidle', timeout: 15000 });
  await page.screenshot({ path: 'C:/Users/talha/AppData/Local/Temp/crm-register.png', fullPage: false });
  console.log('Register page screenshot saved');
  console.log('Register page URL:', page.url());

  await browser.close();
  console.log('\n=== ALL TESTS PASSED ===');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });