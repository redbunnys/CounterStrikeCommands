/**
 * Parse the Valve wiki CS2 console command page into structured JSON.
 *
 * Source: data/raw/cs2_wiki.html (see tools/fetch-valve-wiki.mjs)
 * Tables are class="standard-table" with columns:
 *   Command | Default Value | Flags | Description
 * grouped under <h3> letter sections ("_", "A".."Z").
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SRC = resolve(process.argv[2] ?? 'data/raw/cs2_wiki.html');
const OUT = resolve(process.argv[3] ?? 'data/cs2-commands.raw.json');

const html = readFileSync(SRC, 'utf8');

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

/** Strip tags, drop footnote markers, collapse whitespace. */
const cleanText = (fragment) =>
  decodeEntities(
    fragment
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();

const cellsOf = (rowHtml) =>
  [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1]));

// --- walk the document, tracking the current <h3> letter section and tables ---
const sectionRe = /<h([23])\b[^>]*>[\s\S]*?<span class="mw-headline" id="([^"]*)"[\s\S]*?<\/h\1>|<table\b[^>]*class="[^"]*standard-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;

const records = [];
const warnings = [];
let currentSection = '';
let tableIndex = 0;
let pendingHeader = null;

for (const m of html.matchAll(sectionRe)) {
  if (m[2] !== undefined) {
    // heading match: id is the section key ("_" or a letter)
    currentSection = m[2] || currentSection;
    continue;
  }
  tableIndex++;
  const tableHtml = m[3];
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => r[1]);
  pendingHeader = null;

  for (const row of rows) {
    const cells = cellsOf(row);
    if (cells.length === 0) continue;

    // Header row detection: the wiki uses <th> for "Command | Default Value | Flags | Description"
    if (/<th\b/i.test(row) && cells[0].toLowerCase() === 'command') {
      pendingHeader = cells;
      continue;
    }
    if (cells.length < 4) {
      warnings.push(`table ${tableIndex}: row with ${cells.length} cells: ${cells.join(' | ').slice(0, 120)}`);
      continue;
    }
    const [command, defaultValue, flags, description] = cells;
    if (!command) continue;
    records.push({
      id: records.length + 1,
      command,
      defaultValue: defaultValue === '' ? null : defaultValue,
      flags: flags
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
      description: description || '',
      section: currentSection || '?',
    });
  }
}

const byFlag = {};
for (const r of records) {
  for (const f of r.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;
}

const summary = {
  source: 'https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables',
  sourceRetrieved: 'October 2, 2023',
  sourceBuild: '9832 (revision 8384867)',
  parsedAt: new Date().toISOString(),
  tables: tableIndex,
  total: records.length,
  withDescription: records.filter((r) => r.description).length,
  uniqueDescriptions: new Set(records.filter((r) => r.description).map((r) => r.description)).size,
  sections: [...new Set(records.map((r) => r.section))],
  flagFrequency: Object.fromEntries(Object.entries(byFlag).sort((a, b) => b[1] - a[1])),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, commands: records }, null, 2), 'utf8');

console.log(JSON.stringify(summary, null, 2));
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  console.log(warnings.slice(0, 20).join('\n'));
}
console.log(`\nsaved: ${OUT}`);
