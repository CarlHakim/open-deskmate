import { connect, waitForPageLoad } from "@/client.js";

const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';
const client = await connect();
const page = await client.page(taskId + "-news");

try {
  // Page is already open from previous steps
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(1000);

  // Try multiple selector strategies
  const articles = await page.evaluate(() => {
    const results = [];
    
    // Strategy 1: Look for article tags
    const articles = document.querySelectorAll("article");
    if (articles.length > 0) {
      articles.forEach(art => {
        const title = art.querySelector("h3, h4, div[role='heading']")?.innerText;
        const time = art.querySelector("time")?.innerText;
        if (title) results.push({ title, time, source: "Strategy 1" });
      });
    }

    // Strategy 2: Look for headings directly if article tags fail
    if (results.length === 0) {
      const headings = document.querySelectorAll("h3, h4");
      headings.forEach(h => {
        const link = h.closest("a") || h.querySelector("a");
        if (link && h.innerText.length > 10) {
           results.push({ 
             title: h.innerText, 
             link: link.href,
             source: "Strategy 2" 
           });
        }
      });
    }

    return results;
  });

  console.log(JSON.stringify(articles, null, 2));

} catch (err) {
  console.error(err);
} finally {
  await client.disconnect();
}
