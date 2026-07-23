require('dotenv').config();
const { login, humanDelay } = require('./auth');
const { saveJobs } = require('./storage');
const config = require('../config.json');

// LinkedIn date posted filter codes
const DATE_POSTED_CODES = {
  '24h': 'r86400',
  week: 'r604800',
  month: 'r2592000',
};

// Company slug map for linkedin.com/company/{slug}
const COMPANY_SLUGS = {
  'Microsoft': 'microsoft',
  'Google': 'google',
  'Meta': 'meta',
  'Apple': 'apple',
  'Databricks': 'databricks',
  'Snowflake': 'snowflake',
  'Salesforce': 'salesforce',
  'ServiceNow': 'servicenow',
  'OpenAI': 'openai',
  'Anthropic': 'anthropic',
  'JPMorgan Chase': 'jpmorgan-chase',
  'Uber': 'uber-com',
  'Airbnb': 'airbnb',
  'Netflix': 'netflix',
  'Spotify': 'spotify',
  'Shopify': 'shopify',
  'MongoDB': 'mongodb',
  'Mistral': 'mistralai',
  'Perplexity': 'perplexity-ai',
  'Cohere': 'cohere-ai',
};

function buildCompanyJobsUrl(slug, keyword) {
  const params = new URLSearchParams({
    keywords: keyword,
    f_TPR: DATE_POSTED_CODES[config.postedWithin] || DATE_POSTED_CODES['24h'],
    sortBy: 'DD',
  });
  return `https://www.linkedin.com/company/${slug}/jobs/?${params.toString()}`;
}

async function scrapeCompanyJobs(page, companyName, slug, keyword) {
  const url = buildCompanyJobsUrl(slug, keyword);
  console.log(`  [${companyName}] "${keyword}" → ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(2000, 3500);
  await autoScroll(page);

  const jobs = await page.evaluate((company) => {
    const results = [];
    const cards = document.querySelectorAll([
      'li[data-occludable-job-id]',
      'li[data-job-id]',
      '.job-card-container',
      '.jobs-search-results__list-item',
      '.scaffold-layout__list-item',
    ].join(', '));

    cards.forEach((card) => {
      try {
        const linkEl = card.querySelector('a[href*="/jobs/view/"]');
        const link = linkEl?.href?.split('?')[0];
        const jobId = link?.match(/\/jobs\/view\/(\d+)/)?.[1]
          || card.getAttribute('data-occludable-job-id')
          || card.getAttribute('data-job-id');

        // Parse title and location from card text lines
        const lines = card.innerText?.split('\n').map(l => l.trim()).filter(Boolean) || [];
        const title = lines[0];
        const location = lines.find(l =>
          l.includes('Remote') || l.includes('Hybrid') || l.includes('On-site') ||
          l.match(/,\s+[A-Z]{2}/) || l.includes('United States')
        );
        const postedAt = lines.find(l => l.includes('ago') || l.includes('hour') || l.includes('minute') || l.includes('day'));

        if (!title || !jobId) return;

        results.push({ title, company, location, link, postedAt, jobId });
      } catch (_) {}
    });

    return results;
  }, companyName);

  return jobs;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const container = document.querySelector('.jobs-search-results-list, .scaffold-layout__list') || document.body;
    for (let i = 0; i < 5; i++) {
      container.scrollBy(0, 800);
      await new Promise((r) => setTimeout(r, 600));
    }
  });
  await humanDelay(1000, 2000);
}

async function run() {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;

  if (!email || !password) {
    console.error('Error: LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  console.log('Starting LinkedIn job scraper...');
  console.log(`Keywords: ${config.keywords.join(', ')}`);
  console.log(`Companies: ${config.companies.join(', ')}`);
  console.log(`Posted within: ${config.postedWithin}`);

  const headless = process.env.HEADLESS !== 'false';
  const { browser, page } = await login(email, password, headless);

  const allJobs = [];
  const seen = new Set();

  try {
    for (const companyName of config.companies) {
      const slug = COMPANY_SLUGS[companyName];
      if (!slug) {
        console.warn(`  No slug for "${companyName}", skipping`);
        continue;
      }

      console.log(`\n=== ${companyName} ===`);

      for (const keyword of config.keywords) {
        const jobs = await scrapeCompanyJobs(page, companyName, slug, keyword);
        console.log(`  Found ${jobs.length} jobs for "${keyword}"`);

        for (const job of jobs) {
          const key = job.jobId || `${job.title}|${job.company}`;
          if (seen.has(key)) continue;
          seen.add(key);

          job.searchKeyword = keyword;
          job.scrapedAt = new Date().toISOString();
          allJobs.push(job);
        }

        await humanDelay(1500, 3000);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nTotal unique jobs found: ${allJobs.length}`);

  if (allJobs.length > 0) {
    await saveJobs(allJobs);
    await notifySlack(allJobs);
  } else {
    console.log('No new jobs found in the last 24h matching your criteria.');
  }

  return allJobs;
}

async function notifySlack(jobs) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl || jobs.length === 0) return;

  const text = `*${jobs.length} new LinkedIn jobs found (last 24h)*\n\n` +
    jobs.slice(0, 20).map((j) =>
      `• *${j.title}* at *${j.company}* — ${j.location || 'N/A'}\n  ${j.link || ''}`
    ).join('\n\n');

  try {
    const https = require('https');
    const payload = JSON.stringify({ text });
    const url = new URL(webhookUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, () => {});
    req.write(payload);
    req.end();
    console.log('Slack notification sent.');
  } catch (err) {
    console.warn('Slack notification failed:', err.message);
  }
}

run().catch((err) => {
  console.error('Scraper error:', err);
  process.exit(1);
});

module.exports = { run };
