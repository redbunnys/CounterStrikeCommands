/**
 * Verify that the parse of the Valve wiki page is faithful.
 *
 * Independent of the parser's regex walk, this re-counts content rows directly
 * from the raw HTML (<table class="standard-table"> -> <tr> with 4 <td>) and
 * diffs the counts against data/cs2-commands.raw.json, printing any mismatch.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML = resolve('data/raw/cs2_wiki.html');
const JSON_PATH = resolve('data/cs2-commands.raw.json');

const html = readFileSync(HTML, 'utf8');
const parsed = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

// Independent count: every <tr> in a standard-table whose cells are all <td>.
const tables = [...html.matchAll(/<table\b[^>]*class="[^"]*standard-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi)];
let dataRows = 0;
let headerRows = 0;
const commandsInHtml = new Set();
const placeholderRows = [];
const multiColumnRows = [];

for (const [ti, t] of tables.entries()) {
  const rows = [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const r of rows) {
    if (/<th\b/i.test(r[1])) {
      headerRows++;
      continue;
    }
    dataRows++;
    const tds = [...r[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tds.length > 4) {
      multiColumnRows.push({ table: ti + 1, cells: tds.length, html: r[1].slice(0, 200) });
    }
    // Placeholder rows (empty letter sections) are tagged table-N/A
    if (/table-N\/A/.test(r[1])) {
      placeholderRows.push({ table: ti + 1 });
      continue;
    }
    const first = tds[0] ? tds[0][1].replace(/<[^>]+>/g, '').trim() : '';
    if (first) commandsInHtml.add(first);
  }
}

const parsedNames = new Set(parsed.commands.map((c) => c.command));
const missing = [...commandsInHtml].filter((c) => !parsedNames.has(c));
const extra = [...parsedNames].filter((c) => !commandsInHtml.has(c));

console.log(JSON.stringify({
  htmlTables: tables.length,
  htmlHeaderRows: headerRows,
  htmlDataRows: dataRows,
  htmlPlaceholderRows: placeholderRows.length,
  htmlRowsWithMoreThan4Cells: multiColumnRows.length,
  htmlUniqueCommands: commandsInHtml.size,
  parsedCommands: parsed.commands.length,
  missingFromParse: missing.length,
  extraInParse: extra.length,
  missingSample: missing.slice(0, 10),
  extraSample: extra.slice(0, 10),
  multiColumnSample: multiColumnRows.slice(0, 6).map((m) => ({ table: m.table, cells: m.cells, html: m.html.replace(/\s+/g, ' ') })),
}, null, 2));
