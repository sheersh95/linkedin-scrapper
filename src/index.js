require('dotenv').config();
const cron = require('node-cron');
const { run } = require('./scraper');

const INTERVAL_MINUTES = parseInt(process.env.POLL_INTERVAL_MINUTES || '60', 10);

console.log(`LinkedIn Job Scraper — polling every ${INTERVAL_MINUTES} minutes`);
console.log('Running initial scrape now...\n');

// Run immediately on start
run().catch(console.error);

// Then schedule recurring runs
const cronExpression = `*/${INTERVAL_MINUTES} * * * *`;
cron.schedule(cronExpression, () => {
  console.log(`\n[${new Date().toISOString()}] Running scheduled scrape...`);
  run().catch(console.error);
});

console.log(`Next run scheduled in ${INTERVAL_MINUTES} minutes.`);
