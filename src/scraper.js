require('dotenv').config();
const { login, humanDelay } = require('./auth');
const { saveJobs } = require('./storage');
const config = require('../config.json');

// LinkedIn experience level filter codes
const EXPERIENCE_LEVEL_CODES = {
  internship: '1',
  entry_level: '2',
  associate: '3',
  mid_senior: '4',
  senior: '4',
  director: '5',
  executive: '6',
};

// LinkedIn date posted filter codes
const DATE_POSTED_CODES = {
  '24h': 'r86400',
  week: 'r604800',
  month: 'r2592000',
};

function buildSearchUrl(keyword, location, experienceLevels, datePosted) {
  const base = 'https://www.linkedin.com/jobs/search/';
  const params = new URLSearchParams({
    keywords: keyword,
    location: location,
    f_TPR: DATE_POSTED_CODES[datePosted] || DATE_POSTED_CODES['24h'],
    f_E: experienceLevels.map((l) => EXPERIENCE_LEVEL_CODES[l]).filter(Boolean).join(','),
    sortBy: 'DD', // sort by date
  });
  return `${base}?${params.toString()}`;
}

async function scrapeJobsForSearch(page, keyword, location) {
  const url = buildSearchUrl(keyword, location, config.experienceLevels, config.postedWithin);
  console.log(`\nSearching: "${keyword}" in "${location}"`);
  console.log(`URL: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(2000, 3500);

  // Scroll to load more results
  await autoScroll(page);

  const jobs = await page.evaluate((targetCompanies) => {
    const results = [];

    // Try multiple card container selectors for LinkedIn's current UI
    const cards = document.querySelectorAll([
      'li[data-occludable-job-id]',
      'li[data-job-id]',
      '.job-card-container',
      '.jobs-search-results__list-item',
      '.scaffold-layout__list-item',
    ].join(', '));

    cards.forEach((card) => {
      try {
        // Link containing job ID
        const linkEl = card.querySelector('a[href*="/jobs/view/"]');
        const link = linkEl?.href?.split('?')[0];
        const jobId = link?.match(/\/jobs\/view\/(\d+)/)?.[1]
          || card.getAttribute('data-occludable-job-id')
          || card.getAttribute('data-job-id');

        // Title: try multiple selectors
        const titleEl = card.querySelector([
          '.job-card-list__title--link',
          '.job-card-container__link',
          'a[data-control-id]',
          '.job-card-list__title',
          'strong',
        ].join(', '));
        const title = titleEl?.innerText?.trim() || linkEl?.innerText?.trim();

        // Company: grab all text spans, pick the one that's not the title/location
        const companyEl = card.querySelector([
          '.artdeco-entity-lockup__subtitle span',
          '.job-card-container__primary-description',
          '.job-card-container__company-name',
          '.job-card-list__entity-lockup .artdeco-entity-lockup__subtitle',
          '.topcard__org-name-link',
        ].join(', '));
        const company = companyEl?.innerText?.trim();

        // Location
        const locationEl = card.querySelector([
          '.job-card-container__metadata-item',
          '.artdeco-entity-lockup__caption li',
          '.job-card-container__bullet',
          '.job-card-list__footer-wrapper li',
        ].join(', '));
        const location = locationEl?.innerText?.trim();

        // Posted time
        const timeEl = card.querySelector('time');
        const postedAt = timeEl?.getAttribute('datetime') || timeEl?.innerText?.trim();

        if (!title || !company || !jobId) return;

        // Filter by target companies (case-insensitive partial match)
        const companyLower = company.toLowerCase();
        const isTargetCompany = targetCompanies.some((tc) =>
          companyLower.includes(tc.toLowerCase())
        );

        if (!isTargetCompany) return;

        results.push({ title, company, location, link, postedAt, jobId });
      } catch (_) {}
    });

    return results;
  }, config.companies);

  return jobs;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const container = document.querySelector('.jobs-search-results-list') || document.body;
    for (let i = 0; i < 5; i++) {
      container.scrollBy(0, 800);
      await new Promise((r) => setTimeout(r, 600));
    }
  });
  await humanDelay(1000, 2000);
}

async function scrapeJobDetails(page, job) {
  if (!job.link) return job;

  try {
    await page.goto(job.link, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(1500, 2500);

    const details = await page.evaluate(() => {
      const descEl = document.querySelector('.jobs-description__content, .job-view-layout .description__text');
      const criteriaItems = document.querySelectorAll('.description__job-criteria-item');

      const criteria = {};
      criteriaItems.forEach((item) => {
        const label = item.querySelector('.description__job-criteria-subheader')?.innerText?.trim();
        const value = item.querySelector('.description__job-criteria-text')?.innerText?.trim();
        if (label && value) criteria[label.toLowerCase()] = value;
      });

      return {
        description: descEl?.innerText?.trim()?.slice(0, 2000) || '',
        seniority: criteria['seniority level'] || '',
        employmentType: criteria['employment type'] || '',
        jobFunction: criteria['job function'] || '',
        industries: criteria['industries'] || '',
      };
    });

    return { ...job, ...details };
  } catch (err) {
    console.warn(`  Could not fetch details for ${job.title} at ${job.company}: ${err.message}`);
    return job;
  }
}

async function run() {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;

  if (!email || !password) {
    console.error('Error: LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  console.log('Starting LinkedIn job scraper...');
  console.log(`Searching for: ${config.keywords.join(', ')}`);
  console.log(`Locations: ${config.locations.join(', ')}`);
  console.log(`Companies: ${config.companies.join(', ')}`);
  console.log(`Posted within: ${config.postedWithin}`);

  const headless = process.env.HEADLESS !== 'false';
  const { browser, page } = await login(email, password, headless);

  const allJobs = [];
  const seen = new Set();

  try {
    for (const keyword of config.keywords) {
      for (const location of config.locations) {
        const jobs = await scrapeJobsForSearch(page, keyword, location);
        // Debug: show all raw cards before company filter
  const rawCards = await page.evaluate(() => {
    const cards = document.querySelectorAll('li[data-occludable-job-id], li[data-job-id], .job-card-container, .jobs-search-results__list-item, .scaffold-layout__list-item');
    return [...cards].slice(0, 3).map(c => c.innerText?.trim()?.slice(0, 200));
  });
  console.log(`  Raw cards sample (first 3):`, rawCards);
  console.log(`  Found ${jobs.length} matching jobs after company filter`);

        for (const job of jobs) {
          const key = job.jobId || `${job.title}|${job.company}|${job.link}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const jobWithDetails = await scrapeJobDetails(page, job);
          jobWithDetails.searchKeyword = keyword;
          jobWithDetails.searchLocation = location;
          jobWithDetails.scrapedAt = new Date().toISOString();
          allJobs.push(jobWithDetails);

          await humanDelay(800, 1500);
        }

        await humanDelay(2000, 4000);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nTotal unique jobs found: ${allJobs.length}`);

  if (allJobs.length > 0) {
    await saveJobs(allJobs);
    await notifySlack(allJobs);
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
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, () => {});
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
