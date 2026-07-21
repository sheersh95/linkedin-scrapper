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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    storageState: fs.existsSync(AUTH_STATE_PATH) ? AUTH_STATE_PATH : undefined,
  });

  const page = await context.newPage();

  // Check if already logged in
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/feed')) {
    console.log('Already logged in via saved session.');
    return { browser, context, page };
  }

  console.log('Logging in to LinkedIn...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  await page.fill('#username', email);
  await page.fill('#password', password);
  await humanDelay(500, 1000);
  await page.click('[type="submit"]');

  await page.waitForURL('**/feed/**', { timeout: 30000 }).catch(() => {});

  if (!page.url().includes('/feed')) {
    const html = await page.content();
    if (html.includes('checkpoint') || html.includes('challenge')) {
      throw new Error('LinkedIn requires a security verification. Please log in manually once and save the auth state.');
    }
    throw new Error(`Login failed. Current URL: ${page.url()}`);
  }

  // Save session state
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log('Login successful. Session saved.');

  return { browser, context, page };
}

function humanDelay(min = 300, max = 800) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { login, humanDelay, AUTH_STATE_PATH };
