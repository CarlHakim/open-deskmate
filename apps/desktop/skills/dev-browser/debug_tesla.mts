import { connect, waitForPageLoad } from "@/client.js";

const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';
const client = await connect();
const page = await client.page(taskId + "-news");

try {
  // We are already on the page from previous run (state persists), but let's reload or check
  console.log("Current URL:", page.url());
  
  // Reload to be sure
  await page.goto("https://news.google.com/search?q=Tesla");
  await waitForPageLoad(page);
  await page.waitForTimeout(3000); // Wait for dynamic content

  await page.screenshot({ path: "tesla-debug.png" });
  console.log("Screenshot saved to tesla-debug.png");

  const html = await page.content();
  console.log("HTML Start:", html.substring(0, 500));
  
  // Try to find ANY link text to see structure
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a")).slice(0, 5).map(a => a.innerText);
  });
  console.log("Sample links:", links);

} catch (err) {
  console.error(err);
} finally {
  await client.disconnect();
}
