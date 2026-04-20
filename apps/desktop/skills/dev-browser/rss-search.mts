// @ts-nocheck
import { connect, waitForPageLoad } from "./src/client.js";

const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';
const client = await connect();
const page = await client.page(taskId + "-main");

// Visit Feedspot to get comprehensive list of RSS feeds
await page.goto("https://rss.feedspot.com/renewable_energy_rss_feeds/");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });

// Get snapshot to find RSS feed links
const snapshot = await client.getAISnapshot(taskId + "-main");
console.log(snapshot);

await client.disconnect();
