const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH_STATE_PATH = path.join(__dirname, '..', 'auth_state.json');

async function login(email, password, headless = true) {
  const browser = await chromium.launch({
    headless,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    storageState: fs.existsSync(AUTH_STATE_PATH) ? AUTH_STATE_PATH : undefined,
  });

  const page = await context.newPage();

  // Check if already logged in
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(2000, 3000);
  if (page.url().includes('/feed')) {
    console.log('Already logged in via saved session.');
    return { browser, context, page };
  }

  console.log('Logging in to LinkedIn...');
  await page.goto('https://www.linkedin.com/uas/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(2000, 3000);

  // Dismiss cookie banner if present
  const cookieBtn = page.locator('button[action-type="ACCEPT"], #artdeco-global-alert-action__button, button:has-text("Accept"), button:has-text("Reject")');
  if (await cookieBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await cookieBtn.first().click();
    await humanDelay(1000, 1500);
  }

  // Take a debug screenshot so we can see what LinkedIn is showing
  await page.screenshot({ path: 'debug_login_page.png', fullPage: true });
  console.log('Screenshot saved to debug_login_page.png — check it to see what LinkedIn is showing.');

  // Try multiple possible selectors for the email field
  const emailSelectors = ['#username', 'input[name="session_key"]', 'input[type="email"]', 'input[autocomplete="username"]'];
  let emailField = null;
  for (const sel of emailSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      emailField = el;
      console.log(`Found email field with selector: ${sel}`);
      break;
    }
  }
  if (!emailField) {
    await page.screenshot({ path: 'debug_no_form.png', fullPage: true });
    throw new Error('Could not find email input on login page. Check debug_login_page.png and debug_no_form.png');
  }

  // Type like a human
  await emailField.click();
  await humanDelay(200, 400);
  await emailField.type(email, { delay: 60 });

  await humanDelay(400, 800);

  const passwordField = page.locator('#password, input[name="session_password"], input[type="password"]').first();
  await passwordField.click();
  await humanDelay(200, 400);
  await passwordField.type(password, { delay: 60 });

  await humanDelay(600, 1200);
  await page.click('[type="submit"]');

  // Wait for navigation after login
  await page.waitForURL(/linkedin\.com\/(feed|checkpoint|challenge)/, { timeout: 60000 }).catch(() => {});

  const currentUrl = page.url();
  if (currentUrl.includes('checkpoint') || currentUrl.includes('challenge')) {
    console.error('\n⚠️  LinkedIn requires security verification (CAPTCHA or email code).');
    console.error('Run with headless=false to complete it manually:');
    console.error('  HEADLESS=false node src/scraper.js\n');
    await browser.close();
    process.exit(1);
  }

  if (!currentUrl.includes('/feed')) {
    const html = await page.content();
    console.error('Login page HTML snippet:', html.slice(0, 500));
    throw new Error(`Login failed. Current URL: ${currentUrl}`);
  }

  // Save session state for future runs
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log('Login successful. Session saved to auth_state.json');

  return { browser, context, page };
}

function humanDelay(min = 300, max = 800) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { login, humanDelay, AUTH_STATE_PATH };
