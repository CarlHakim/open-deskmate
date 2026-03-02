const Database = require('better-sqlite3');

try {
  const db = new Database(':memory:');
  const row = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') as enabled").get();
  db.close();
  if (!row || row.enabled !== 1) {
    console.error('[memory-tools] FTS5 is not enabled in the bundled SQLite build.');
    process.exit(1);
  }
  console.log('[memory-tools] FTS5 is enabled.');
} catch (err) {
  console.error('[memory-tools] Failed to verify FTS5:', err?.message || err);
  process.exit(1);
}
