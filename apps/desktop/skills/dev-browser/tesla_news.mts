import { connect, waitForPageLoad } from "@/client.js";

const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';
const client = await connect();
const page = await client.page(taskId + "-news");

try {
  console.log("Navigating to Google News...");
  await page.goto("https://news.google.com/search?q=Tesla");
  await waitForPageLoad(page);

  // Handle consent
  try {
    const consentButton = await page.getByRole("button", { name: /Accept all|I agree|Agree/i }).first();
    if (await consentButton.isVisible({ timeout: 2000 })) {
      console.log("Clicking consent button...");
      await consentButton.click();
      await waitForPageLoad(page);
    }
  } catch (e) {}

  // Wait for articles
  try {
    await page.waitForSelector("article", { timeout: 5000 });
  } catch (e) {
    console.log("No articles found immediately, waiting a bit more...");
    await page.waitForTimeout(2000);
  }

  const articles = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("article"));
    return items.slice(0, 15).map(item => {
      const titleEl = item.querySelector("h3 a, h4 a, a");
      const timeEl = item.querySelector("time");
      const sourceEl = item.querySelector(".vr1PYe, .wEwyrc, div[data-n-tid]"); 
      
      return {
        title: titleEl ? titleEl.innerText : "No title",
        link: titleEl ? titleEl.href : "",
        time: timeEl ? timeEl.innerText : "",
        timeAbs: timeEl ? timeEl.getAttribute('datetime') : "",
        source: sourceEl ? sourceEl.innerText : "Unknown"
      };
    }).filter(a => a.title !== "No title");
  });

  console.log(JSON.stringify(articles, null, 2));

} catch (err) {
  console.error("Error running script:", err);
} finally {
  await client.disconnect();
}
