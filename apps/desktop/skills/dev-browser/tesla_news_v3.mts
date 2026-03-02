import { connect, waitForPageLoad } from "@/client.js";

const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';
const client = await connect();
const page = await client.page(taskId + "-news");

try {
  console.log("Scrolling for more news...");
  // Scroll down a few times to trigger lazy loading
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(1000);
  }

  const articles = await page.evaluate(() => {
    const results = [];
    const seenTitles = new Set();

    // aggressive extraction: find all 'a' tags with substantial text
    const links = document.querySelectorAll("a");
    
    links.forEach(a => {
      const title = a.innerText.trim();
      const href = a.href;
      
      // Filter out short links, nav links, etc.
      // News headlines are usually decent length
      if (title.length > 25 && !seenTitles.has(title)) {
        // Basic heuristic: check if it looks like a headline
        // Often Google News headlines have specific classes, but text length is a good fallback
        // We also check if it contains relevant keywords to reduce noise if we just grabbed random links
        // But for a search page, most big links are results.
        
        // Check if parent is likely a header or article container
        const parent = a.parentElement;
        const isHeader = parent.tagName.match(/^H\d/);
        const hasTimeSibling = parent.parentElement?.querySelector("time");
        
        if (isHeader || hasTimeSibling || title.toLowerCase().includes("tesla") || title.toLowerCase().includes("musk")) {
             seenTitles.add(title);
             results.push({
               title: title.replace(/\n/g, ' '),
               link: href
             });
        }
      }
    });

    return results;
  });

  console.log(JSON.stringify(articles.slice(0, 15), null, 2));

} catch (err) {
  console.error(err);
} finally {
  await client.disconnect();
}
