// Parses the question-bank markdown tables (README.md, question-bank/page-N.md).
// Shared by the Bun server and the browser fallback, so keep it dependency-free.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const TABLE_HEADER = /^\|\s*Company\s*\|\s*OA \/ Interview Question\s*\|/;

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\|/g, '|'));
}

function parseUpdated(raw) {
  const isHot = raw.includes('🔥');
  const isNew = raw.includes('🆕');
  const display = raw.replace(/[🔥🆕]/gu, '').trim();
  const m = display.match(/([A-Za-z]{3})\w*\s+(\d{1,2}),\s+(\d{4})/);
  const isoDate = m
    ? `${m[3]}-${String(MONTHS[m[1].toLowerCase()] || 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
    : '';
  return { date: display, isoDate, isHot, isNew };
}

export function parseQuestionTable(markdown) {
  const out = [];
  let inTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (!inTable) {
      inTable = TABLE_HEADER.test(line);
      continue;
    }
    if (!line.startsWith('|')) {
      if (out.length) break;
      continue;
    }
    if (/^\|\s*:?-/.test(line)) continue;

    const cells = splitRow(line);
    if (cells.length < 5) continue;
    const [companyRaw, questionRaw, format, , updatedRaw] = cells;

    const link = questionRaw.match(/^\[(.+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (!link) continue;
    const url = link[2];

    const companies = companyRaw
      .replace(/^\*\*(.*)\*\*$/, '$1')
      .split('/')
      .map(c => c.trim())
      .filter(Boolean);

    out.push({
      id: url.replace(/\/+$/, '').split('/').pop(),
      title: link[1].replace(/\\([\[\]|*_])/g, '$1'),
      url,
      companies,
      format: format || 'Coding',
      ...parseUpdated(updatedRaw || ''),
    });
  }
  return out;
}

// Merges pages (newest first) into one bank, dropping duplicate URLs and
// disambiguating ids that collide across formats.
export function buildBank(markdownPages, extraMeta = {}) {
  const seenUrls = new Set();
  const seenIds = new Set();
  const questions = [];

  for (const page of markdownPages) {
    for (const q of parseQuestionTable(page)) {
      if (seenUrls.has(q.url)) continue;
      seenUrls.add(q.url);
      if (seenIds.has(q.id)) {
        q.id = `${q.id}--${q.format.toLowerCase().replace(/[^a-z]+/g, '-')}`;
      }
      seenIds.add(q.id);
      questions.push(q);
    }
  }

  const formatCounts = {};
  const companyCounts = {};
  for (const q of questions) {
    formatCounts[q.format] = (formatCounts[q.format] || 0) + 1;
    for (const c of q.companies) companyCounts[c] = (companyCounts[c] || 0) + 1;
  }

  return {
    metadata: {
      total: questions.length,
      formatCounts,
      companies: Object.entries(companyCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
      ...extraMeta,
    },
    questions,
  };
}
