// @ts-nocheck
import { connect, waitForPageLoad } from "@/client.js";

const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';
const client = await connect();

const page = await client.page(taskId + "-main");

// Search for NIO Q4 2025 earnings specifically
await page.goto("https://www.bing.com/news/search?q=NIO+Q4+2025+earnings+total+revenue+net+income+profit+CNY");
await waitForPageLoad(page);

await page.waitForTimeout(3000);

const content = await page.evaluate(() => {
  return document.body.innerText.substring(0, 12000);
});

console.log(content);
await client.disconnect();
