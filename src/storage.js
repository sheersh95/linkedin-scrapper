const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
const config = require('../config.json');

const OUTPUT_DIR = path.resolve(config.outputDir || './output');
const SEEN_JOBS_PATH = path.join(OUTPUT_DIR, 'seen_jobs.json');

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadSeenJobs() {
  if (!fs.existsSync(SEEN_JOBS_PATH)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_JOBS_PATH, 'utf-8'));
    return new Set(data);
  } catch {
    return new Set();
  }
}

function saveSeenJobs(seenSet) {
  fs.writeFileSync(SEEN_JOBS_PATH, JSON.stringify([...seenSet], null, 2));
}

async function saveJobs(jobs) {
  ensureOutputDir();

  const seenJobs = loadSeenJobs();
  const newJobs = jobs.filter((j) => {
    const key = j.jobId || `${j.title}|${j.company}`;
    return !seenJobs.has(key);
  });

  if (newJobs.length === 0) {
    console.log('No new jobs since last run.');
    return;
  }

  // Mark as seen
  newJobs.forEach((j) => {
    const key = j.jobId || `${j.title}|${j.company}`;
    seenJobs.add(key);
  });
  saveSeenJobs(seenJobs);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Save JSON
  const jsonPath = path.join(OUTPUT_DIR, `jobs_${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(newJobs, null, 2));
  console.log(`Saved ${newJobs.length} new jobs to ${jsonPath}`);

  // Save CSV
  const csvPath = path.join(OUTPUT_DIR, `jobs_${timestamp}.csv`);
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: 'title', title: 'Title' },
      { id: 'company', title: 'Company' },
      { id: 'location', title: 'Location' },
      { id: 'seniority', title: 'Seniority' },
      { id: 'employmentType', title: 'Employment Type' },
      { id: 'postedAt', title: 'Posted At' },
      { id: 'searchKeyword', title: 'Search Keyword' },
      { id: 'searchLocation', title: 'Search Location' },
      { id: 'scrapedAt', title: 'Scraped At' },
      { id: 'link', title: 'Link' },
    ],
  });
  await csvWriter.writeRecords(newJobs);
  console.log(`Saved CSV to ${csvPath}`);

  // Append to master CSV
  const masterCsvPath = path.join(OUTPUT_DIR, 'all_jobs.csv');
  const masterExists = fs.existsSync(masterCsvPath);
  const masterWriter = createObjectCsvWriter({
    path: masterCsvPath,
    header: [
      { id: 'title', title: 'Title' },
      { id: 'company', title: 'Company' },
      { id: 'location', title: 'Location' },
      { id: 'seniority', title: 'Seniority' },
      { id: 'employmentType', title: 'Employment Type' },
      { id: 'postedAt', title: 'Posted At' },
      { id: 'searchKeyword', title: 'Search Keyword' },
      { id: 'searchLocation', title: 'Search Location' },
      { id: 'scrapedAt', title: 'Scraped At' },
      { id: 'link', title: 'Link' },
    ],
    append: masterExists,
  });
  await masterWriter.writeRecords(newJobs);

  console.log(`\n=== ${newJobs.length} NEW jobs saved ===`);
  newJobs.forEach((j) => console.log(`  [${j.company}] ${j.title} — ${j.location || 'N/A'}`));

  return newJobs;
}

module.exports = { saveJobs };
