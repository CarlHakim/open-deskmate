const TABLE_SEPARATOR_CELL_PATTERN = /^:?-{3,}:?$/;

function isMarkdownTableSeparatorRow(row: string): boolean {
  const cells = row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);

  return cells.length > 1 && cells.every((cell) => TABLE_SEPARATOR_CELL_PATTERN.test(cell));
}

function getMarkdownTableColumnCount(row: string): number {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .length;
}

function normalizeCompactMarkdownTableLine(line: string): string {
  if (!line.includes('|') || !/\|\s*:?-{3,}:?\s*\|/.test(line)) {
    return line;
  }

  const firstPipeIndex = line.indexOf('|');
  if (firstPipeIndex === -1) return line;

  const prefix = line.slice(0, firstPipeIndex).trimEnd();
  const tableText = line.slice(firstPipeIndex).trim();
  const rows = tableText
    .replace(/\s+\|\s+\|/g, ' |\n|')
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length < 2 || !isMarkdownTableSeparatorRow(rows[1])) {
    return line;
  }

  const headerColumnCount = getMarkdownTableColumnCount(rows[0]);
  const separatorColumnCount = getMarkdownTableColumnCount(rows[1]);
  if (headerColumnCount < 2 || headerColumnCount !== separatorColumnCount) {
    return line;
  }

  const normalizedRows = rows.map((row) => {
    let normalized = row;
    if (!normalized.startsWith('|')) normalized = `| ${normalized}`;
    if (!normalized.endsWith('|')) normalized = `${normalized} |`;
    return normalized;
  });

  const table = normalizedRows.join('\n');
  return prefix ? `${prefix}\n\n${table}` : table;
}

export function normalizeMarkdownTables(markdown: string): string {
  const lines = String(markdown || '').split(/\r?\n/);
  let inFence = false;

  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : normalizeCompactMarkdownTableLine(line);
    })
    .join('\n');
}
