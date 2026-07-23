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
      '--window-size=1440,900',
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
  if (await cookieBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await cookieBtn.first().click();
    await humanDelay(1000, 1500);
  }

  // LinkedIn's new React login page uses dynamic IDs — target by type + visibility
  const emailField = page.locator('input[type="email"]:visible').first();
  await emailField.waitFor({ state: 'visible', timeout: 15000 });

  console.log('Filling in credentials...');
  await emailField.click();
  await humanDelay(200, 400);
  await emailField.fill(email);

  await humanDelay(400, 800);

  const passwordField = page.locator('input[type="password"]:visible').first();
  await passwordField.click();
  await humanDelay(200, 400);
  await passwordField.fill(password);

  await humanDelay(600, 1200);
  await page.locator('button[type="submit"], [data-litms-control-urn="login-submit"]').first().click();

  // Wait for navigation after login
  await page.waitForURL(/linkedin\.com\/(feed|checkpoint|challenge)/, { timeout: 60000 }).catch(() => {});

  const currentUrl = page.url();
  if (currentUrl.includes('checkpoint') || currentUrl.includes('challenge')) {
    console.log('\n⚠️  LinkedIn requires security verification.');
    console.log('Complete it in the browser window, then press Enter here to continue...');
    await new Promise((r) => process.stdin.once('data', r));
    await context.storageState({ path: AUTH_STATE_PATH });
    return { browser, context, page };
  }

  if (!currentUrl.includes('/feed')) {
    throw new Error(`Login failed. Current URL: ${currentUrl}`);
  }

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log('Login successful. Session saved to auth_state.json');

  return { browser, context, page };
}

function humanDelay(min = 300, max = 800) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { login, humanDelay, AUTH_STATE_PATH };
