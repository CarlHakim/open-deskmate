import { normalizeMarkdownTables } from './markdown-tables';

const RTF_COLOR_TABLE = [
  '',
  '\\red17\\green24\\blue39',
  '\\red156\\green163\\blue175',
  '\\red229\\green231\\blue235',
  '\\red249\\green250\\blue251',
  '\\red5\\green99\\blue193',
  '\\red243\\green244\\blue246',
  '\\red209\\green213\\blue219',
].join(';');

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRtfPlain(value: string): string {
  let result = '';
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      result += '\\\\';
      continue;
    }
    if (char === '{') {
      result += '\\{';
      continue;
    }
    if (char === '}') {
      result += '\\}';
      continue;
    }
    if (char === '\n') {
      result += '\\line ';
      continue;
    }
    if (char === '\r') continue;

    const codeUnit = text.charCodeAt(index);
    if (codeUnit > 127) {
      const signed = codeUnit > 32767 ? codeUnit - 65536 : codeUnit;
      result += `\\u${signed}?`;
    } else {
      result += char;
    }
  }
  return result;
}

function isEmojiLikeCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2600 && codePoint <= 0x27bf)
    || (codePoint >= 0x1f000 && codePoint <= 0x1faff)
    || codePoint === 0x00a9
    || codePoint === 0x00ae
    || codePoint === 0x203c
    || codePoint === 0x2049
    || codePoint === 0x2122
    || codePoint === 0x2139
    || codePoint === 0x3030
    || codePoint === 0x303d
    || codePoint === 0x3297
    || codePoint === 0x3299
  );
}

function isEmojiSequenceCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0xfe0f
    || codePoint === 0xfe0e
    || codePoint === 0x200d
    || codePoint === 0x20e3
    || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  );
}

function readEmojiSequence(text: string, startIndex: number): { sequence: string; nextIndex: number } | null {
  const codePoint = text.codePointAt(startIndex) ?? 0;
  if (!isEmojiLikeCodePoint(codePoint)) return null;

  let sequence = String.fromCodePoint(codePoint);
  let index = startIndex + sequence.length;
  while (index < text.length) {
    const nextCodePoint = text.codePointAt(index) ?? 0;
    if (!isEmojiSequenceCodePoint(nextCodePoint)) break;
    const nextChar = String.fromCodePoint(nextCodePoint);
    sequence += nextChar;
    index += nextChar.length;
    if (nextCodePoint === 0x200d && index < text.length) {
      const joinedCodePoint = text.codePointAt(index) ?? 0;
      const joinedChar = String.fromCodePoint(joinedCodePoint);
      sequence += joinedChar;
      index += joinedChar.length;
    }
  }
  return { sequence, nextIndex: index };
}

function escapeRtf(value: string): string {
  let result = '';
  const text = String(value || '');
  for (let index = 0; index < text.length;) {
    const emoji = readEmojiSequence(text, index);
    if (!emoji) {
      const codePoint = text.codePointAt(index) ?? 0;
      const char = String.fromCodePoint(codePoint);
      result += escapeRtfPlain(char);
      index += char.length;
      continue;
    }
    result += `{\\f2 ${escapeRtfPlain(emoji.sequence)}\\f0}`;
    index = emoji.nextIndex;
  }
  return result;
}

function markdownInlineToHtml(value: string): string {
  const linkPlaceholders: string[] = [];
  const withPlaceholders = String(value || '').replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)]+)\)/g,
    (_match, label: string, url: string) => {
      const token = `__ODM_RICH_LINK_${linkPlaceholders.length}__`;
      linkPlaceholders.push(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
      return token;
    }
  );
  let html = escapeHtml(withPlaceholders);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  linkPlaceholders.forEach((linkHtml, index) => {
    html = html.replace(`__ODM_RICH_LINK_${index}__`, linkHtml);
  });
  return html;
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line?: string): boolean {
  if (!line) return false;
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function markdownToHtmlFragment(markdownText: string): string {
  const lines = normalizeMarkdownTables(markdownText).split(/\r?\n/);
  const blocks: string[] = [];
  let index = 0;

  const isBlockStart = (line: string, nextLine?: string) => (
    !line.trim()
    || /^#{1,6}\s+/.test(line)
    || /^>\s?/.test(line)
    || /^[-*+]\s+/.test(line)
    || /^\d+[.)]\s+/.test(line)
    || /^```/.test(line)
    || (line.includes('|') && isMarkdownTableSeparator(nextLine))
  );

  while (index < lines.length) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !/^```/.test(lines[index]?.trim() || '')) {
        codeLines.push(lines[index] || '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${markdownInlineToHtml(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (trimmed.includes('|') && isMarkdownTableSeparator(lines[index + 1])) {
      const headers = parseMarkdownTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] || '').includes('|') && (lines[index] || '').trim()) {
        rows.push(parseMarkdownTableRow(lines[index] || ''));
        index += 1;
      }
      blocks.push([
        '<table><thead><tr>',
        headers.map((cell) => `<th>${markdownInlineToHtml(cell)}</th>`).join(''),
        '</tr></thead><tbody>',
        rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${markdownInlineToHtml(row[cellIndex] || '')}</td>`).join('')}</tr>`).join(''),
        '</tbody></table>',
      ].join(''));
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items: string[] = [];
      while (index < lines.length) {
        const itemLine = (lines[index] || '').trim();
        const match = ordered ? itemLine.match(/^\d+[.)]\s+(.+)$/) : itemLine.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${markdownInlineToHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] || '').trim())) {
        quoteLines.push((lines[index] || '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${quoteLines.map((quoteLine) => `<p>${markdownInlineToHtml(quoteLine)}</p>`).join('')}</blockquote>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isBlockStart(lines[index] || '', lines[index + 1])) {
      paragraphLines.push((lines[index] || '').trim());
      index += 1;
    }
    if (paragraphLines.length === 0) {
      paragraphLines.push(trimmed);
      index += 1;
    }
    blocks.push(`<p>${markdownInlineToHtml(paragraphLines.join(' '))}</p>`);
  }

  return blocks.join('');
}

function dataUrlImageToRtfPicture(src: string, alt: string, width?: number, height?: number): string | null {
  const match = src.match(/^data:image\/(png|jpe?g);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;

  try {
    const binary = window.atob(match[2]);
    let hex = '';
    for (let index = 0; index < binary.length; index += 1) {
      hex += binary.charCodeAt(index).toString(16).padStart(2, '0');
    }
    const blip = /^jpe?g$/i.test(match[1]) ? 'jpegblip' : 'pngblip';
    const hasExplicitSize = Number.isFinite(width) && Number(width) > 0 && Number.isFinite(height) && Number(height) > 0;
    const safeWidth = hasExplicitSize ? Math.max(1, Math.min(2400, Math.round(width || 0))) : 0;
    const safeHeight = hasExplicitSize ? Math.max(1, Math.min(2400, Math.round(height || 0))) : 0;
    const size = hasExplicitSize
      ? `\\picw${safeWidth}\\pich${safeHeight}\\picwgoal${Math.round(safeWidth * 15)}\\pichgoal${Math.round(safeHeight * 15)}`
      : '';
    return `{\\pict\\${blip}${size} ${hex}}`;
  } catch {
    return `[Image: ${escapeRtf(alt || 'image')}]`;
  }
}

function getSvgLabel(svg: SVGElement): string {
  return svg.getAttribute('aria-label')
    || svg.querySelector('title')?.textContent
    || svg.getAttribute('data-icon')
    || 'icon';
}

function isVisibleSvgPaint(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized)
    && normalized !== 'none'
    && normalized !== 'transparent'
    && normalized !== 'rgba(0, 0, 0, 0)';
}

function applyResolvedSvgPaint(target: SVGElement, paintName: 'stroke' | 'fill', computedValue?: string | null, fallbackColor?: string): void {
  const currentValue = target.getAttribute(paintName) || target.style[paintName];
  const resolved = isVisibleSvgPaint(computedValue)
    ? computedValue
    : currentValue?.toLowerCase() === 'currentcolor' && fallbackColor
      ? fallbackColor
      : null;
  if (!resolved) return;
  target.setAttribute(paintName, resolved);
  target.style[paintName] = resolved;
}

function inlineCurrentColorAttributes(svg: SVGSVGElement, originalSvg: SVGSVGElement): void {
  const rootStyle = window.getComputedStyle(originalSvg);
  const rootColor = rootStyle.color || originalSvg.closest<HTMLElement>('[style],a,button,span,div')?.style.color || '#111827';
  svg.setAttribute('color', rootColor);
  svg.style.color = rootColor;
  applyResolvedSvgPaint(svg, 'stroke', rootStyle.stroke, rootColor);
  applyResolvedSvgPaint(svg, 'fill', rootStyle.fill, rootColor);

  const originalChildren = Array.from(originalSvg.querySelectorAll<SVGElement>('*'));
  const clonedChildren = Array.from(svg.querySelectorAll<SVGElement>('*'));
  clonedChildren.forEach((child, index) => {
    const originalChild = originalChildren[index];
    const childStyle = originalChild ? window.getComputedStyle(originalChild) : rootStyle;
    const childColor = childStyle.color || rootColor;
    child.setAttribute('color', childColor);
    applyResolvedSvgPaint(child, 'stroke', childStyle.stroke, childColor);
    applyResolvedSvgPaint(child, 'fill', childStyle.fill, childColor);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to render SVG icon.'));
    image.src = src;
  });
}

async function svgToPngDataUrl(svg: SVGSVGElement): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(12, Math.min(96, Math.round(rect.width || Number(svg.getAttribute('width')) || 16)));
  const height = Math.max(12, Math.min(96, Math.round(rect.height || Number(svg.getAttribute('height')) || 16)));
  const svgClone = svg.cloneNode(true) as SVGSVGElement;
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgClone.setAttribute('width', String(width));
  svgClone.setAttribute('height', String(height));
  if (!svgClone.getAttribute('viewBox')) {
    svgClone.setAttribute('viewBox', svg.getAttribute('viewBox') || `0 0 ${width} ${height}`);
  }
  inlineCurrentColorAttributes(svgClone, svg);

  const serialized = new XMLSerializer().serializeToString(svgClone);
  const objectUrl = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(objectUrl);
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const emojiImageCache = new Map<string, { dataUrl: string; width: number; height: number }>();

function emojiToPngDataUrl(sequence: string, displaySize: number): { dataUrl: string; width: number; height: number } | null {
  if (typeof document === 'undefined') return null;
  const safeDisplaySize = Math.max(10, Math.min(48, Math.round(displaySize || 16)));
  const cacheKey = `${sequence}:${safeDisplaySize}`;
  const cached = emojiImageCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  const size = Math.max(16, Math.round(safeDisplaySize * 1.7));
  const padding = 3;
  const scale = 2;
  canvas.width = (size + padding * 2) * scale;
  canvas.height = (size + padding * 2) * scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(scale, scale);
  context.clearRect(0, 0, size + padding * 2, size + padding * 2);
  context.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(sequence, (size + padding * 2) / 2, (size + padding * 2) / 2 + 1);

  const result = {
    dataUrl: canvas.toDataURL('image/png'),
    width: safeDisplaySize,
    height: safeDisplaySize,
  };
  emojiImageCache.set(cacheKey, result);
  return result;
}

function replaceEmojiTextNodesWithImages(root: HTMLElement): void {
  if (typeof document === 'undefined') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';
    const parentElement = textNode.parentElement;
    const parentStyle = parentElement ? window.getComputedStyle(parentElement) : null;
    const displaySize = Number.parseFloat(parentStyle?.fontSize || '') || 16;
    let index = 0;
    let changed = false;
    const fragment = document.createDocumentFragment();
    while (index < text.length) {
      const emoji = readEmojiSequence(text, index);
      if (!emoji) {
        const codePoint = text.codePointAt(index) ?? 0;
        const char = String.fromCodePoint(codePoint);
        fragment.appendChild(document.createTextNode(char));
        index += char.length;
        continue;
      }

      const imageData = emojiToPngDataUrl(emoji.sequence, displaySize);
      if (!imageData) {
        fragment.appendChild(document.createTextNode(emoji.sequence));
      } else {
        const image = document.createElement('img');
        image.src = imageData.dataUrl;
        image.alt = emoji.sequence;
        image.setAttribute('data-rtf-width', String(imageData.width));
        image.setAttribute('data-rtf-height', String(imageData.height));
        image.setAttribute('data-rtf-emoji', 'true');
        fragment.appendChild(image);
      }
      changed = true;
      index = emoji.nextIndex;
    }
    if (changed) {
      textNode.replaceWith(fragment);
    }
  }
}

function cssPixelValue(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(String(value || ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pxToTwips(value: number): number {
  return Math.max(0, Math.round(value * 15));
}

function pxToHalfPoints(value: number): number {
  return Math.max(1, Math.round(value * 1.5));
}

function lineHeightPxFromStyle(style: CSSStyleDeclaration): number {
  const fontSize = cssPixelValue(style.fontSize, 14.66);
  const lineHeight = cssPixelValue(style.lineHeight, 0);
  return lineHeight > 0 ? lineHeight : fontSize * 1.35;
}

function writeRtfMetrics(target: HTMLElement, style: CSSStyleDeclaration): void {
  target.setAttribute('data-rtf-line-height-twips', String(pxToTwips(lineHeightPxFromStyle(style))));
  target.setAttribute('data-rtf-space-before-twips', String(pxToTwips(cssPixelValue(style.marginTop, 0))));
  target.setAttribute('data-rtf-space-after-twips', String(pxToTwips(cssPixelValue(style.marginBottom, 0))));
  target.setAttribute('data-rtf-font-size-half-points', String(pxToHalfPoints(cssPixelValue(style.fontSize, 14.66))));
}

function copyComputedRtfMetrics(source: HTMLElement, targetRoot: HTMLElement): void {
  if (typeof window === 'undefined') return;
  const sourceElements = Array.from(source.querySelectorAll<HTMLElement>('*'));
  const targetElements = Array.from(targetRoot.querySelectorAll<HTMLElement>('*'));
  sourceElements.forEach((sourceElement, index) => {
    const targetElement = targetElements[index];
    if (!targetElement) return;
    writeRtfMetrics(targetElement, window.getComputedStyle(sourceElement));
  });
}

function getRtfFontSize(element: HTMLElement | null | undefined, fallbackHalfPoints = 22): number {
  const parsed = Number.parseInt(element?.getAttribute('data-rtf-font-size-half-points') || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackHalfPoints;
}

function getRtfParagraphControls(element: HTMLElement | null | undefined, fallbackFontHalfPoints = 22): string {
  const lineHeight = Number.parseInt(element?.getAttribute('data-rtf-line-height-twips') || '', 10);
  const before = Number.parseInt(element?.getAttribute('data-rtf-space-before-twips') || '', 10);
  const after = Number.parseInt(element?.getAttribute('data-rtf-space-after-twips') || '', 10);
  const fallbackLineHeight = Math.round((fallbackFontHalfPoints / 2) * 1.35 * 20);
  return [
    `\\sl${Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fallbackLineHeight}`,
    '\\slmult0',
    `\\sb${Number.isFinite(before) && before > 0 ? Math.min(before, 720) : 0}`,
    `\\sa${Number.isFinite(after) && after > 0 ? Math.min(after, 720) : 120}`,
  ].join('');
}

function getRtfInlineContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeRtf(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  const children = Array.from(element.childNodes).map(getRtfInlineContent).join('');

  switch (element.tagName) {
    case 'BR':
      return '\\line ';
    case 'STRONG':
    case 'B':
      return `{\\b ${children}\\b0}`;
    case 'EM':
    case 'I':
      return `{\\i ${children}\\i0}`;
    case 'U':
      return `{\\ul ${children}\\ulnone}`;
    case 'S':
    case 'DEL':
      return `{\\strike ${children}\\strike0}`;
    case 'CODE':
      return `{\\f1\\highlight6 ${children}\\highlight0\\f0}`;
    case 'A': {
      const href = element.getAttribute('href');
      if (!href) return children;
      return `{\\field{\\*\\fldinst{HYPERLINK "${escapeRtf(href)}"}}{\\fldrslt{\\ul\\cf5 ${children || escapeRtf(href)}\\ulnone\\cf1}}}`;
    }
    case 'IMG': {
      const src = element.getAttribute('src') || '';
      const alt = element.getAttribute('alt') || src || 'image';
      const width = Number(element.getAttribute('data-rtf-width') || element.getAttribute('width') || 0) || undefined;
      const height = Number(element.getAttribute('data-rtf-height') || element.getAttribute('height') || 0) || undefined;
      return dataUrlImageToRtfPicture(src, alt, width, height) || `[Image: ${escapeRtf(alt)}]`;
    }
    case 'SVG': {
      const label = element.getAttribute('aria-label')
        || element.querySelector('title')?.textContent
        || element.getAttribute('data-icon')
        || '';
      return label ? escapeRtf(label) : '';
    }
    default:
      return children;
  }
}

function getTableColumnWidths(table: HTMLTableElement, maxCells: number): number[] {
  const defaultTableWidth = 9000;
  const minTableWidth = 3600;
  const maxTableWidth = 10800;
  const minColumnWidth = 720;
  const measuredWidths = Array.from({ length: maxCells }, () => 0);
  const contentWeights = Array.from({ length: maxCells }, () => 1);

  for (const row of Array.from(table.rows)) {
    let columnIndex = 0;
    for (const cell of Array.from(row.cells)) {
      if (columnIndex >= maxCells) break;
      const colSpan = Math.max(1, Math.min(maxCells - columnIndex, Number(cell.colSpan) || 1));
      const rect = cell.getBoundingClientRect();
      const measuredWidth = Number.isFinite(rect.width) && rect.width > 0 ? rect.width / colSpan : 0;
      const contentWeight = Math.max(3, (cell.textContent || '').trim().length) / colSpan;
      for (let offset = 0; offset < colSpan; offset += 1) {
        measuredWidths[columnIndex + offset] = Math.max(measuredWidths[columnIndex + offset], measuredWidth);
        contentWeights[columnIndex + offset] = Math.max(contentWeights[columnIndex + offset], contentWeight);
      }
      columnIndex += colSpan;
    }
  }

  const measuredTotal = measuredWidths.reduce((sum, width) => sum + width, 0);
  const tableRect = table.getBoundingClientRect();
  const tablePixelWidth = Number.isFinite(tableRect.width) && tableRect.width > 0
    ? tableRect.width
    : measuredTotal;
  const tableWidth = measuredTotal > 0
    ? Math.max(minTableWidth, Math.min(maxTableWidth, Math.round(tablePixelWidth * 15)))
    : defaultTableWidth;
  const weights = measuredTotal > 0
    ? measuredWidths.map((width) => Math.max(1, width))
    : contentWeights;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || maxCells;
  const widths = weights.map((weight) => Math.max(minColumnWidth, Math.round((tableWidth * weight) / totalWeight)));
  const widthTotal = widths.reduce((sum, width) => sum + width, 0);
  widths[widths.length - 1] = Math.max(minColumnWidth, widths[widths.length - 1] + (tableWidth - widthTotal));
  return widths;
}

function getRtfTable(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  const maxCells = rows.reduce((max, row) => Math.max(max, row.cells.length), 1);
  const columnWidths = getTableColumnWidths(table, maxCells);
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

  return rows.map((row, rowIndex) => {
    const cells = Array.from(row.cells);
    const rowIsHeader = row.parentElement?.tagName === 'THEAD'
      || cells.some((cell) => cell.tagName === 'TH')
      || rowIndex === 0 && cells.every((cell) => cell.tagName === 'TH');
    let rightBoundary = 0;
    const cellDefinitions = columnWidths.map((width, columnIndex) => {
      rightBoundary += width;
      const cell = cells[columnIndex];
      const isHeader = rowIsHeader || cell?.tagName === 'TH';
      const shade = isHeader ? '\\clcbpat3' : rowIndex % 2 === 0 ? '\\clcbpat4' : '';
      return [
        '\\clvertalt',
        '\\clbrdrt\\brdrs\\brdrw10\\brdrcf2',
        '\\clbrdrl\\brdrs\\brdrw10\\brdrcf2',
        '\\clbrdrb\\brdrs\\brdrw10\\brdrcf2',
        '\\clbrdrr\\brdrs\\brdrw10\\brdrcf2',
        '\\clpadl120\\clpadr120\\clpadt80\\clpadb80\\clpadfl3\\clpadfr3\\clpadft3\\clpadfb3',
        shade,
        `\\clftsWidth3\\clwWidth${width}\\cellx${rightBoundary}`,
      ].filter(Boolean).join('');
    }).join('');

    const cellContents = Array.from({ length: maxCells }, (_unused, index) => {
      const cell = cells[index];
      const isHeader = rowIsHeader || cell?.tagName === 'TH';
      const content = cell ? getRtfInlineContent(cell) : '';
      const fontSize = getRtfFontSize(cell || null, 20);
      const paragraphControls = getRtfParagraphControls(cell || null, fontSize);
      return `\\pard\\intbl\\plain${paragraphControls}\\fs${fontSize}\\cf1 ${isHeader ? `\\b ${content}\\b0` : content}\\cell`;
    }).join('');
    return `\\trowd\\trautofit0\\trgaph108\\trleft0\\trftsWidth3\\trwWidth${tableWidth}${cellDefinitions}${cellContents}\\row\n`;
  }).join('');
}

function getRtfBlocksFromNodes(nodes: Node[]): string {
  return nodes.map((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      return text ? `\\pard\\plain${getRtfParagraphControls(null)}\\fs22\\cf1 ${escapeRtf(text)}\\par\n` : '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const element = node as HTMLElement;
    const tagName = element.tagName;

    if (/^H[1-6]$/.test(tagName)) {
      const level = Number(tagName.slice(1));
      const fontSize = [0, 40, 32, 28, 24, 22, 20][level] || 24;
      return `\\pard\\plain\\s${level}\\outlinelevel${level - 1}${getRtfParagraphControls(element, fontSize)}\\b\\fs${fontSize}\\cf1 ${getRtfInlineContent(element)}\\b0\\par\n`;
    }

    if (tagName === 'TABLE') {
      return `${getRtfTable(element as HTMLTableElement)}\\pard\\plain\\fs22\\par\n`;
    }

    if (tagName === 'UL' || tagName === 'OL') {
      return Array.from(element.children)
        .filter((child) => child.tagName === 'LI')
        .map((child, index) => {
          const item = child as HTMLElement;
          const fontSize = getRtfFontSize(item, 22);
          const marker = tagName === 'OL' ? `${index + 1}.` : '\\bullet';
          return `\\pard\\plain\\fi-240\\li520${getRtfParagraphControls(item, fontSize)}\\fs${fontSize}\\cf1 ${marker}\\tab ${getRtfInlineContent(child)}\\par\n`;
        })
        .join('');
    }

    if (tagName === 'PRE') {
      const fontSize = getRtfFontSize(element, 20);
      return `\\pard\\plain${getRtfParagraphControls(element, fontSize)}\\f1\\fs${fontSize}\\cf1\\highlight6 ${escapeRtf(element.textContent || '')}\\highlight0\\par\n`;
    }

    if (tagName === 'BLOCKQUOTE') {
      const fontSize = getRtfFontSize(element, 22);
      return `\\pard\\plain\\li360${getRtfParagraphControls(element, fontSize)}\\fs${fontSize}\\i\\cf1 ${getRtfInlineContent(element)}\\i0\\par\n`;
    }

    if (tagName === 'P') {
      const fontSize = getRtfFontSize(element, 22);
      return `\\pard\\plain${getRtfParagraphControls(element, fontSize)}\\fs${fontSize}\\cf1 ${getRtfInlineContent(element)}\\par\n`;
    }

    const blockChildren = Array.from(element.childNodes);
    if (blockChildren.some((child) => child.nodeType === Node.ELEMENT_NODE && /^(H[1-6]|P|UL|OL|TABLE|PRE|BLOCKQUOTE|DIV)$/i.test((child as HTMLElement).tagName))) {
      return getRtfBlocksFromNodes(blockChildren);
    }

    const inline = getRtfInlineContent(element).trim();
    const fontSize = getRtfFontSize(element, 22);
    return inline ? `\\pard\\plain${getRtfParagraphControls(element, fontSize)}\\fs${fontSize}\\cf1 ${inline}\\par\n` : '';
  }).join('');
}

function rtfBlocksFromMarkdown(markdownText: string): string {
  if (typeof document === 'undefined') {
    return `\\pard\\plain\\fs22\\cf1 ${escapeRtf(markdownText)}\\par\n`;
  }
  const container = document.createElement('div');
  container.innerHTML = markdownToHtmlFragment(markdownText);
  const content = getRtfBlocksFromNodes(Array.from(container.childNodes));
  return content.trim() ? content : `\\pard\\plain\\fs22\\cf1 ${escapeRtf(markdownText)}\\par\n`;
}

function cloneExportSource(source: HTMLElement | null, fallbackText: string): HTMLElement | null {
  if (!source && typeof document === 'undefined') return null;
  const container = document.createElement('div');
  const cloned = source?.cloneNode(true) as HTMLElement | undefined;
  container.innerHTML = cloned?.innerHTML?.trim() || markdownToHtmlFragment(fallbackText);
  if (source) {
    copyComputedRtfMetrics(source, container);
  }
  container.querySelectorAll('button,[data-copy-ignore="true"]').forEach((element) => element.remove());
  return container;
}

async function cloneExportSourceWithRenderedSvgIcons(source: HTMLElement | null, fallbackText: string): Promise<HTMLElement | null> {
  const container = cloneExportSource(source, fallbackText);
  if (!container) return container;
  replaceEmojiTextNodesWithImages(container);
  if (!source) return container;

  const originalSvgs = Array.from(source.querySelectorAll<SVGSVGElement>('svg'));
  const clonedSvgs = Array.from(container.querySelectorAll<SVGSVGElement>('svg'));
  await Promise.all(clonedSvgs.map(async (clonedSvg, index) => {
    const originalSvg = originalSvgs[index];
    if (!originalSvg) return;
    const rendered = await svgToPngDataUrl(originalSvg);
    if (!rendered) {
      const label = document.createTextNode(getSvgLabel(originalSvg));
      clonedSvg.replaceWith(label);
      return;
    }
    const image = document.createElement('img');
    image.src = rendered.dataUrl;
    image.alt = getSvgLabel(originalSvg);
    image.setAttribute('data-rtf-width', String(rendered.width));
    image.setAttribute('data-rtf-height', String(rendered.height));
    clonedSvg.replaceWith(image);
  }));

  return container;
}

export function buildWordFriendlyRtf(source: HTMLElement | null, fallbackText: string): string {
  const exportSource = cloneExportSource(source, fallbackText);
  const sourceContent = exportSource
    ? getRtfBlocksFromNodes(Array.from(exportSource.childNodes))
    : '';
  const content = sourceContent.trim()
    ? sourceContent
    : rtfBlocksFromMarkdown(fallbackText);

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Arial;}{\\f1 Consolas;}{\\f2 Segoe UI Emoji;}}
{\\colortbl${RTF_COLOR_TABLE};}
{\\stylesheet
{\\s0 Normal;}
{\\s1\\b\\fs40\\outlinelevel0 Heading 1;}
{\\s2\\b\\fs32\\outlinelevel1 Heading 2;}
{\\s3\\b\\fs28\\outlinelevel2 Heading 3;}
{\\s4\\b\\fs24\\outlinelevel3 Heading 4;}
{\\s5\\b\\fs22\\outlinelevel4 Heading 5;}
{\\s6\\b\\fs20\\outlinelevel5 Heading 6;}
}
\\viewkind4\\uc1\\pard\\plain\\fs22\\cf1
${content}}`;
}

export async function buildWordFriendlyRtfWithRenderedIcons(source: HTMLElement | null, fallbackText: string): Promise<string> {
  const exportSource = await cloneExportSourceWithRenderedSvgIcons(source, fallbackText);
  const sourceContent = exportSource
    ? getRtfBlocksFromNodes(Array.from(exportSource.childNodes))
    : '';
  const content = sourceContent.trim()
    ? sourceContent
    : rtfBlocksFromMarkdown(fallbackText);

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Arial;}{\\f1 Consolas;}{\\f2 Segoe UI Emoji;}}
{\\colortbl${RTF_COLOR_TABLE};}
{\\stylesheet
{\\s0 Normal;}
{\\s1\\b\\fs40\\outlinelevel0 Heading 1;}
{\\s2\\b\\fs32\\outlinelevel1 Heading 2;}
{\\s3\\b\\fs28\\outlinelevel2 Heading 3;}
{\\s4\\b\\fs24\\outlinelevel3 Heading 4;}
{\\s5\\b\\fs22\\outlinelevel4 Heading 5;}
{\\s6\\b\\fs20\\outlinelevel5 Heading 6;}
}
\\viewkind4\\uc1\\pard\\plain\\fs22\\cf1
${content}}`;
}
