#!/usr/bin/env node
/**
 * tools/verify-dataset.mjs — independent verification of the frozen dataset.
 *
 * Re-derives every invariant from the OUTPUT files only (data/commands.json,
 * data/translation/chunks/*.json, data/translation/glossary.json) and from the
 * raw parse (data/cs2-commands.raw.json) where a cross-check is meaningful.
 * It does not import tools/prepare-data.mjs, so a bug there cannot mask itself.
 *
 * Exit code 0 = all invariants hold, 1 = at least one failure.
 * Usage: node tools/verify-dataset.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'commands.json');
const RAW = join(ROOT, 'data', 'cs2-commands.raw.json');
const TX = join(ROOT, 'data', 'translation');
const CHUNK_DIR = join(TX, 'chunks');
const OUT_DIR = join(TX, 'out');

const FLAG_WHITELIST = [
  'sv', 'cl', 'rep', 'cheat', 'release', 'nf', 'a', 'per_user', 'user', 'norecord',
  'sp', 'demo', 'nolog', 'server_can_execute', 'clientcmd_can_execute',
  'vconsole_fuzzy', 'vconsole_set_focus', 'server_cant_query', 'prot',
  'execute_per_tick', 'disconnected',
];
const FLAG_SET = new Set(FLAG_WHITELIST);
const EXPECTED_COMMANDS = 2528;
const EXPECTED_REPAIRS = {
  tv_broadcast_url: 'http://localhost:8080',
  tv_broadcast_url1: 'http://localhost:8080',
  cl_promoted_settings_acknowledged: '1696196680965',
  sv_mapvetopickvote_phase_duration: '[1 | 5][2 | 15][3:20][4:10][5:10][6:5]',
};
const RECORD_KEYS = ['id', 'command', 'defaultValue', 'flags', 'descriptionEn', 'descriptionZh', 'section'];

const results = [];
let failed = 0;
function check(label, ok, detail = '') {
  results.push({ label, ok: !!ok, detail });
  if (!ok) failed++;
}

const dataset = JSON.parse(readFileSync(DATA, 'utf8'));
const raw = JSON.parse(readFileSync(RAW, 'utf8'));
const { meta, commands } = dataset;

/* ------------------------------------------------------------------ schema */

check('commands.json has meta and commands', !!meta && Array.isArray(commands));
check('commands.length === 2528', commands.length === EXPECTED_COMMANDS, `got ${commands.length}`);
check(
  'every record carries exactly the frozen keys in order',
  commands.every((c) => JSON.stringify(Object.keys(c)) === JSON.stringify(RECORD_KEYS)),
  (() => {
    const bad = commands.find((c) => JSON.stringify(Object.keys(c)) !== JSON.stringify(RECORD_KEYS));
    return bad ? `first offender: ${bad.command} -> ${Object.keys(bad).join(',')}` : '';
  })()
);
check(
  'id is a contiguous 1..2528 sequence',
  commands.every((c, i) => c.id === i + 1),
  (() => {
    const bad = commands.find((c, i) => c.id !== i + 1);
    return bad ? `offender: ${bad.command} id=${bad.id}` : '';
  })()
);
check(
  'commands are sorted ascending',
  commands.every((c, i) => i === 0 || commands[i - 1].command < c.command),
  (() => {
    const bad = commands.find((c, i) => i > 0 && !(commands[i - 1].command < c.command));
    return bad ? `offender: ${bad.command}` : '';
  })()
);
const dupes = commands.map((c) => c.command).filter((v, i, a) => a.indexOf(v) !== i);
check('every command is unique', dupes.length === 0, dupes.slice(0, 5).join(', '));
check('no "N/A" placeholder rows remain', !commands.some((c) => c.command === 'N/A'));
check(
  'defaultValue is string|null',
  commands.every((c) => c.defaultValue === null || typeof c.defaultValue === 'string')
);
check(
  'descriptionEn/descriptionZh are strings',
  commands.every((c) => typeof c.descriptionEn === 'string' && typeof c.descriptionZh === 'string')
);
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const mergedCommands = commands.filter((c) => c.descriptionZh !== '').length;
if (mergedCommands === 0) {
  check('pre-merge stage: descriptionZh is still empty everywhere', true);
} else {
  // post-merge stage: the dataset must be fully translated
  check(
    'merged stage: every command with descriptionEn has a non-empty CJK descriptionZh',
    commands.every((c) => !c.descriptionEn || (typeof c.descriptionZh === 'string' && c.descriptionZh.trim() !== '' && CJK_RE.test(c.descriptionZh))),
    (() => {
      const bad = commands.find((c) => c.descriptionEn && (!c.descriptionZh || !CJK_RE.test(c.descriptionZh)));
      return bad ? `offender: ${bad.command}` : '';
    })()
  );
  check(
    'merged stage: commands without descriptionEn keep an empty descriptionZh',
    commands.every((c) => c.descriptionEn || c.descriptionZh === ''),
    (() => {
      const bad = commands.find((c) => !c.descriptionEn && c.descriptionZh !== '');
      return bad ? `offender: ${bad.command}` : '';
    })()
  );
  check(
    'merged stage: filled count === withEnglishDescription',
    mergedCommands === meta.withEnglishDescription,
    `${mergedCommands} vs ${meta.withEnglishDescription}`
  );
}
check(
  'section is a letter A-Z or "_"',
  commands.every((c) => /^[A-Z_]$/.test(c.section)),
  [...new Set(commands.map((c) => c.section))].filter((s) => !/^[A-Z_]$/.test(s)).join(',')
);
check('no "Cvar_list" section survives', !commands.some((c) => c.section === 'Cvar_list'));

/* ------------------------------------------------------------------- flags */

check(
  'every flag is whitelisted',
  commands.every((c) => Array.isArray(c.flags) && c.flags.every((f) => FLAG_SET.has(f))),
  (() => {
    const bad = commands.find((c) => c.flags.some((f) => !FLAG_SET.has(f)));
    return bad ? `offender: ${bad.command} -> ${bad.flags.join(',')}` : '';
  })()
);
check('no row repeats a flag', commands.every((c) => new Set(c.flags).size === c.flags.length));
check(
  'whitelist has exactly the 21 contract flags',
  FLAG_WHITELIST.length === 21 && new Set(FLAG_WHITELIST).size === 21
);

// cross-check against the raw parse: for every row that was not repaired, the
// emitted flag list must be the raw list filtered to the whitelist, order kept.
const repairedNames = new Set(Object.keys(EXPECTED_REPAIRS));
const rawByName = new Map(raw.commands.map((r) => [r.command, r]));
const flagMismatch = commands
  .filter((c) => !repairedNames.has(c.command))
  .map((c) => ({ c, r: rawByName.get(c.command) }))
  .filter(({ c, r }) => {
    if (!r) return true;
    const expected = [...new Set(r.flags.filter((f) => FLAG_SET.has(f)))];
    return expected.join(',') !== c.flags.join(',');
  });
check(
  'flags match the raw parse (whitelist-filtered, order kept, deduped) for all non-repaired rows',
  flagMismatch.length === 0,
  flagMismatch.slice(0, 5).map(({ c }) => c.command).join(', ')
);

/* ------------------------------------------------------- repaired wiki rows */

check(
  'meta lists exactly the four repaired rows',
  JSON.stringify((meta.repairedRows ?? []).map((r) => r.command).sort()) ===
    JSON.stringify(Object.keys(EXPECTED_REPAIRS).sort()),
  JSON.stringify((meta.repairedRows ?? []).map((r) => r.command))
);
for (const [cmd, expected] of Object.entries(EXPECTED_REPAIRS)) {
  const row = commands.find((c) => c.command === cmd);
  check(`repaired defaultValue of ${cmd}`, !!row && row.defaultValue === expected, row ? JSON.stringify(row.defaultValue) : 'missing row');
}
const tv = commands.find((c) => c.command === 'tv_broadcast_url');
check('tv_broadcast_url flags are [release]', !!tv && tv.flags.join(',') === 'release', tv ? tv.flags.join(',') : '');
const cps = commands.find((c) => c.command === 'cl_promoted_settings_acknowledged');
check(
  'cl_promoted_settings_acknowledged flags are [cl, a]',
  !!cps && cps.flags.join(',') === 'cl,a',
  cps ? cps.flags.join(',') : ''
);

/* ---------------------------------------------------------- chunk integrity */

const chunkFiles = readdirSync(CHUNK_DIR).filter((f) => /^chunk-\d{3}\.json$/.test(f)).sort();
check('chunk files exist', chunkFiles.length > 0, chunkFiles.join(', '));
check('meta.chunks matches the number of chunk files', meta.chunks === chunkFiles.length, `${meta.chunks} vs ${chunkFiles.length}`);

const seenIndices = new Map();
const allDescriptions = [];
let chunkProblems = [];
for (const [i, file] of chunkFiles.entries()) {
  const expectedName = `chunk-${String(i + 1).padStart(3, '0')}`;
  const chunk = JSON.parse(readFileSync(join(CHUNK_DIR, file), 'utf8'));
  if (chunk.chunk !== expectedName) chunkProblems.push(`${file}: chunk field is ${chunk.chunk}`);
  if (!Array.isArray(chunk.indices) || !Array.isArray(chunk.descriptions)) {
    chunkProblems.push(`${file}: indices/descriptions must be arrays`);
    continue;
  }
  if (chunk.indices.length !== chunk.descriptions.length) chunkProblems.push(`${file}: length mismatch`);
  if (chunk.descriptions.length > meta.chunkSize) chunkProblems.push(`${file}: exceeds chunkSize`);
  chunk.indices.forEach((idx, k) => {
    if (typeof idx !== 'number' || !Number.isInteger(idx)) chunkProblems.push(`${file}: non-integer index ${idx}`);
    if (seenIndices.has(idx)) chunkProblems.push(`${file}: duplicate index ${idx}`);
    seenIndices.set(idx, chunk.descriptions[k]);
  });
  allDescriptions.push(...chunk.descriptions);
}
check('chunk files are self-consistent', chunkProblems.length === 0, chunkProblems.slice(0, 5).join(' | '));

const indexKeys = [...seenIndices.keys()].sort((a, b) => a - b);
check(
  'chunk indices cover 0..N-1 contiguously (no gap, no overlap)',
  indexKeys.length > 0 && indexKeys.every((v, i) => v === i),
  `min=${indexKeys[0]} max=${indexKeys[indexKeys.length - 1]} count=${indexKeys.length}`
);
check(
  'all chunk descriptions are non-empty',
  allDescriptions.every((d) => typeof d === 'string' && d.length > 0),
  allDescriptions.filter((d) => !d).length + ' empty'
);
check(
  'index order in every chunk file is ascending',
  chunkFiles.every((file) => {
    const c = JSON.parse(readFileSync(join(CHUNK_DIR, file), 'utf8'));
    return c.indices.every((v, i) => i === 0 || v > c.indices[i - 1]);
  })
);

/* ----------------------------- description count invariants (the headline) */

const descSet = new Set();
for (const c of commands) if (c.descriptionEn) descSet.add(c.descriptionEn);
const withEnglish = commands.filter((c) => c.descriptionEn).length;

check('unique non-empty English descriptions === chunk description total', descSet.size === allDescriptions.length, `${descSet.size} vs ${allDescriptions.length}`);
check('unique non-empty English descriptions === max index + 1', descSet.size === indexKeys.length && indexKeys.every((v, i) => v === i), `${descSet.size} vs ${indexKeys.length}`);
check('withEnglishDescription matches the dataset', meta.withEnglishDescription === withEnglish, `${meta.withEnglishDescription} vs ${withEnglish}`);
check('meta.uniqueEnglishDescriptions matches', meta.uniqueEnglishDescriptions === descSet.size, `${meta.uniqueEnglishDescriptions} vs ${descSet.size}`);
check(
  'every command descriptionEn resolves to a chunk index (or is empty)',
  commands.every((c) => !c.descriptionEn || seenIndices.get(indexOfDescription(c.descriptionEn)) === c.descriptionEn),
  ''
);
function indexOfDescription(desc) {
  for (const [idx, d] of seenIndices) if (d === desc) return idx;
  return -1;
}
const unresolved = commands.filter((c) => c.descriptionEn && indexOfDescription(c.descriptionEn) === -1);
check('no unresolved descriptions', unresolved.length === 0, unresolved.slice(0, 5).map((c) => c.command).join(', '));
check(
  'chunk descriptions are globally unique',
  new Set(allDescriptions).size === allDescriptions.length,
  `${new Set(allDescriptions).size} vs ${allDescriptions.length}`
);

/* -------------------------------------------------------- meta / glossary */

for (const key of [
  'source', 'sourceRetrieved', 'sourceBuild', 'generatedAt', 'commands',
  'withEnglishDescription', 'uniqueEnglishDescriptions', 'chunks',
]) {
  check(`meta.${key} present`, meta[key] !== undefined && meta[key] !== null && meta[key] !== '');
}
check('meta.commands === 2528', meta.commands === EXPECTED_COMMANDS, String(meta.commands));
check('meta.sections has no Cvar_list', !(meta.sections ?? []).includes('Cvar_list'));

const glossary = JSON.parse(readFileSync(join(TX, 'glossary.json'), 'utf8'));
check('glossary covers all 21 flags', Object.keys(glossary.flags ?? {}).length === 21, Object.keys(glossary.flags ?? {}).length + '');
check(
  'every flag has a Chinese name and a note',
  Object.values(glossary.flags ?? {}).every((v) => v.zh && v.note && /[\u4e00-\u9fff]/.test(v.zh))
);
check(
  'flag labels are keyed by whitelisted flags only',
  Object.keys(glossary.flags ?? {}).every((f) => FLAG_SET.has(f))
);
const termKeys = Object.keys(glossary.terms ?? {});
check(`glossary has >= 60 core terms`, termKeys.length >= 60, String(termKeys.length));
check(
  'core terms are non-empty Chinese',
  termKeys.every((k) => typeof glossary.terms[k] === 'string' && glossary.terms[k].length > 0)
);
check(
  'required sample terms exist (convar/demo/warmup/spectator/hostage/hitbox/tickrate)',
  ['convar', 'demo', 'warmup', 'spectator', 'hostage', 'hitbox', 'tickrate'].every((k) => k in (glossary.terms ?? {})),
  ['convar', 'demo', 'warmup', 'spectator', 'hostage', 'hitbox', 'tickrate'].filter((k) => !(k in (glossary.terms ?? {}))).join(', ')
);
check('glossary has a do-not-translate section', !!glossary.doNotTranslate);
check('glossary has Chinese flag-order reference', Array.isArray(glossary.flagOrder) && glossary.flagOrder.join(',') === FLAG_WHITELIST.join(','));

/* ------------------------------------------------------------- work area */

check('data/translation/README.md exists', existsSync(join(TX, 'README.md')));
const readme = readFileSync(join(TX, 'README.md'), 'utf8');
check('README documents the output schema', readme.includes('"entries"') && readme.includes('chunk-NNN.json'));
check('README lists the hard constraints', readme.includes('硬性约束'));
check('data/translation/out/ exists', existsSync(OUT_DIR));
check(
  'data/translation/out/ is a directory holding .gitkeep',
  existsSync(join(OUT_DIR, '.gitkeep')),
  readdirSync(OUT_DIR).join(', ')
);

/* ---------------------- merged translations (post-merge stage, independent) */

const outFiles = readdirSync(OUT_DIR).filter((f) => /^chunk-\d{3}\.json$/.test(f)).sort();
check('translation output files exist (10 expected)', outFiles.length === chunkFiles.length, `${outFiles.length} vs ${chunkFiles.length}`);

const outKeyProblems = [];
const translationByIndex = new Map();
for (const f of outFiles) {
  const out = JSON.parse(readFileSync(join(OUT_DIR, f), 'utf8'));
  const chunk = JSON.parse(readFileSync(join(CHUNK_DIR, f), 'utf8'));
  const expected = new Set(chunk.indices.map(String));
  const actual = new Set(Object.keys(out.entries ?? {}));
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  const nonDecimal = [...actual].filter((k) => !/^\d+$/.test(k));
  if (missing.length || extra.length || nonDecimal.length) outKeyProblems.push({ file: f, missing, extra, nonDecimal });
  for (const [k, v] of Object.entries(out.entries ?? {})) translationByIndex.set(Number(k), v);
}
check(
  'every translation output: entries keys === chunk indices (no more, no less)',
  outKeyProblems.length === 0,
  JSON.stringify(outKeyProblems).slice(0, 400)
);
check(
  'translation outputs cover all description indices exactly once',
  translationByIndex.size === indexKeys.length,
  `${translationByIndex.size} vs ${indexKeys.length}`
);
check(
  'every translation value is a non-empty CJK string',
  [...translationByIndex.values()].every((v) => typeof v === 'string' && v.trim() !== '' && CJK_RE.test(v)),
  [...translationByIndex.entries()].filter(([, v]) => typeof v !== 'string' || v.trim() === '' || !CJK_RE.test(v)).slice(0, 5).map(([i]) => i).join(', ')
);
if (mergedCommands > 0) {
  const mismatch = commands.filter(
    (c) => c.descriptionEn && c.descriptionZh !== translationByIndex.get(indexOfDescription(c.descriptionEn))
  );
  check(
    'merged dataset: descriptionZh equals the chunk-mapped translation for every command',
    mismatch.length === 0,
    mismatch.slice(0, 5).map((c) => c.command).join(', ')
  );
}

/* --------------------------------------------- frontend runtime data copy */

const PUBLIC_DATA = join(ROOT, 'app', 'public', 'data', 'commands.json');
const frontendCopyExists = existsSync(PUBLIC_DATA);
check('app/public/data/commands.json exists (frontend runtime copy)', frontendCopyExists, PUBLIC_DATA);
if (frontendCopyExists) {
  const a = readFileSync(DATA);
  const b = readFileSync(PUBLIC_DATA);
  check(
    'frontend copy is byte-identical to data/commands.json',
    createHash('sha256').update(a).digest('hex') === createHash('sha256').update(b).digest('hex') && a.length === b.length,
    `${a.length} vs ${b.length} bytes`
  );
}

/* --------------------- wiki corrupt-row audit (nbsp entity + colon run-on) --
 * The four corrupt rows in the served wiki HTML squeeze
 * "<leftover value> : <flags> : <description>" into the Flags/Description cells,
 * separating the pieces with "&#160;:" (nbsp + colon). This audit re-derives the
 * corrupt-row set from the raw HTML itself and FAILS if the set is not exactly the
 * set enumerated in meta.repairedRows — a future repeat of the corruption, or a
 * repair that no longer matches its source, can never pass silently.
 */
const HTML_PATH = join(ROOT, 'data', 'raw', 'cs2_wiki.html');
const WIKI_NBSP_COLON = /(?:&#160;|&nbsp;)\s*:|&#x[aA]0;|&#160/; // marker as served in the HTML
const NBSP_CHARS = /[\u00a0\u2007\u202f]/;

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

const cleanCell = (fragment) =>
  decodeEntities(
    fragment
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();

const html = readFileSync(HTML_PATH, 'utf8');
const htmlTables = [...html.matchAll(/<table\b[^>]*class="[^"]*standard-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi)];
// Walk the document once to learn the letter section each standard-table belongs to
// (the page groups its tables under <h2>/<h3> headings; "Cvar_list" is rendered as "_").
const sectionByTable = [];
{
  const walk = /<h([23])\b[^>]*>[\s\S]*?<span class="mw-headline" id="([^"]*)"[\s\S]*?<\/h\1>|<table\b[^>]*class="[^"]*standard-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  let current = '';
  for (const m of html.matchAll(walk)) {
    if (m[2] !== undefined) {
      current = m[2] || current;
    } else {
      sectionByTable.push(current === 'Cvar_list' ? '_' : current);
    }
  }
}
const htmlDataRows = [];
for (const [ti, t] of htmlTables.entries()) {
  for (const [ri, tr] of [...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].entries()) {
    if (/<th\b/i.test(tr[1])) continue;
    const rawCells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    htmlDataRows.push({
      table: ti + 1,
      row: ri + 1,
      section: sectionByTable[ti] ?? '',
      placeholder: /table-N\/A/.test(tr[1]),
      cells: rawCells.map((raw) => ({ raw, text: cleanCell(raw) })),
    });
  }
}
check('html tables parsed', htmlTables.length > 0, String(htmlTables.length));
check(
  'html section headings resolved for every standard-table',
  sectionByTable.length === htmlTables.length && sectionByTable.every((s) => /^[A-Z_]$/.test(s)),
  `sections=[${sectionByTable.join(',')}] tables=${htmlTables.length}`
);

// criterion A (authoritative): a cell carrying the nbsp+colon entity marker.
const criterionA = htmlDataRows.filter((r) => r.cells.some((c) => WIKI_NBSP_COLON.test(c.raw)));
// criterion B (independent heuristic): a non-placeholder row whose Flags cell holds
// a token outside the engine-flag whitelist.
const criterionB = htmlDataRows.filter(
  (r) =>
    !r.placeholder &&
    (r.cells[2]?.text ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
      .some((f) => !FLAG_SET.has(f))
);
const namesOf = (rows) => rows.map((r) => r.cells[0]?.text ?? '').sort();
const corruptNames = namesOf(criterionA);

// criterion C (misalignment, orthogonal to A and B): the wiki template is
// `Command | Default Value | Flags | Description`, so a Default Value cell holding a
// bare engine-flag token — or a Default Value cell identical to the Flags cell — means
// the row's fields slid one column left. Such a row carries no nbsp marker and its
// Flags cell may hold only whitelisted tokens, so criteria A and B both miss it.
const normaliseFlagText = (text) =>
  text.split(',').map((s) => s.trim()).filter(Boolean).join(',').toLowerCase();
const criterionC = htmlDataRows.filter((r) => {
  if (r.placeholder) return false;
  const dv = (r.cells[1]?.text ?? '').trim();
  const flagText = r.cells[2]?.text ?? '';
  const bareFlag = dv !== '' && FLAG_SET.has(dv.toLowerCase());
  const identical = dv !== '' && normaliseFlagText(dv) === normaliseFlagText(flagText);
  return bareFlag || identical;
});check(
  'criterion C (misaligned row: bare flag token as Default Value) finds no row outside meta.repairedRows',
  criterionC.every((r) => (meta.repairedRows ?? []).some((x) => x.command === r.cells[0]?.text)),
  `unregistered: ${namesOf(criterionC).filter((n) => !(meta.repairedRows ?? []).some((x) => x.command === n)).join(', ')}`
);

check(
  'the two independent corruption criteria agree',
  JSON.stringify(namesOf(criterionA)) === JSON.stringify(namesOf(criterionB)),
  `A=[${namesOf(criterionA)}] B=[${namesOf(criterionB)}]`
);
check(
  'html corrupt-row set === meta.repairedRows set (no unfixed/new corrupt row)',
  JSON.stringify(corruptNames) === JSON.stringify((meta.repairedRows ?? []).map((r) => r.command).sort()),
  `html=[${corruptNames}] meta=[${(meta.repairedRows ?? []).map((r) => r.command).sort()}]`
);
check(
  'meta.repairedRows entries carry wiki cells -> restored fields',
  (meta.repairedRows ?? []).every(
    (r) =>
      r.wikiCells &&
      typeof r.wikiCells.description === 'string' &&
      'defaultValue' in r.wikiCells &&
      r.restored &&
      typeof r.restored.defaultValue === 'string' &&
      Array.isArray(r.restored.flags)
  )
);
check(
  'every repaired row is restored to its meta values in the dataset',
  (meta.repairedRows ?? []).every((r) => {
    const row = commands.find((c) => c.command === r.command);
    return (
      !!row &&
      row.defaultValue === r.restored.defaultValue &&
      row.flags.join(',') === r.restored.flags.join(',') &&
      row.descriptionEn === r.restored.descriptionEn
    );
  })
);
check(
  'no residue: no dataset field carries the nbsp marker',
  commands.every(
    (c) =>
      !WIKI_NBSP_COLON.test(c.descriptionEn) &&
      !WIKI_NBSP_COLON.test(c.defaultValue ?? '') &&
      !NBSP_CHARS.test(c.descriptionEn)
  ),
  (() => {
    const bad = commands.find(
      (c) => WIKI_NBSP_COLON.test(c.descriptionEn) || NBSP_CHARS.test(c.descriptionEn) || WIKI_NBSP_COLON.test(c.defaultValue ?? '')
    );
    return bad ? `offender: ${bad.command}` : '';
  })()
);

/* ------------------------------- neighbour contamination around corrupt rows */

const byCommand = new Map(commands.map((c) => [c.command, c]));
const restoredByName = new Map((meta.repairedRows ?? []).map((r) => [r.command, r.restored]));
const neighborReport = [];
let neighborMismatch = 0;

for (const row of criterionA) {
  const idx = htmlDataRows.indexOf(row);
  for (const [side, nb] of [['prev', htmlDataRows[idx - 1]], ['next', htmlDataRows[idx + 1]]]) {
    const subject = row.cells[0]?.text ?? '';
    if (!nb || nb.placeholder) {
      neighborReport.push({ subject, side, neighbor: nb ? (nb.cells[0]?.text ?? '') : '(none)', status: 'skipped' });
      continue;
    }
    const [command, defaultValueCell, flagsCell, descriptionCell] = nb.cells.map((c) => c.text);
    const record = byCommand.get(command);
    // A neighbour may itself be a corrupt row (tv_broadcast_url1 is next to
    // tv_broadcast_url) — then compare against its restored values.
    const restored = restoredByName.get(command);
    const expected = restored ?? {
      defaultValue: defaultValueCell === '' ? null : defaultValueCell,
      flags: [...new Set((flagsCell ?? '').split(',').map((f) => f.trim()).filter((f) => FLAG_SET.has(f)))],
      descriptionEn: descriptionCell ?? '',
    };
    const problems = [];
    if (!record) problems.push('command missing from data/commands.json');
    else {
      if (record.defaultValue !== expected.defaultValue)
        problems.push(`defaultValue ${JSON.stringify(record.defaultValue)} != html ${JSON.stringify(expected.defaultValue)}`);
      if (record.flags.join(',') !== expected.flags.join(','))
        problems.push(`flags [${record.flags}] != html [${expected.flags}]`);
      if (record.descriptionEn !== expected.descriptionEn)
        problems.push(`descriptionEn ${JSON.stringify(record.descriptionEn)} != html ${JSON.stringify(expected.descriptionEn)}`);
      if (WIKI_NBSP_COLON.test(descriptionCell ?? '') || NBSP_CHARS.test(descriptionCell ?? ''))
        problems.push('neighbour cell itself carries the nbsp marker');
    }
    if (problems.length) neighborMismatch++;
    neighborReport.push({
      subject,
      side,
      neighbor: command,
      table: nb.table,
      status: problems.length ? 'MISMATCH' : restored ? 'OK (repaired row)' : 'OK',
      problems,
    });
  }
}

check(
  'no neighbour of a corrupt row is contaminated (prev/next compared field by field)',
  neighborMismatch === 0,
  neighborReport.filter((n) => n.status === 'MISMATCH').map((n) => `${n.neighbor}[${n.side}]`).join(', ')
);
check(
  'every corrupt row had both neighbours resolved',
  criterionA.every((r) => {
    const idx = htmlDataRows.indexOf(r);
    return htmlDataRows[idx - 1]?.cells?.[0]?.text && htmlDataRows[idx + 1]?.cells?.[0]?.text;
  })
);
check(
  'no command field carries an un-repaired placeholder',
  !commands.some((c) => c.command === 'N/A' || c.defaultValue === 'N/A' || c.descriptionEn === 'N/A')
);

/* --------- F5: full HTML <-> dataset comparison (every row, every field) -------
 * Long-term guard rail, implemented from scratch (the verifier's own full scan is
 * not reused). For every row of every standard-table the five visible fields are
 * re-derived from the served HTML — Command, Default Value, Flags, Description and
 * the letter Section — and compared with data/commands.json. Rows the wiki renders
 * corrupt are compared against the values recorded in meta.repairedRows.restored.
 * Any row that exists on only one side is reported too, so a row injected into the
 * parse (or silently dropped) can never pass unnoticed.
 */
const placeholderRows = htmlDataRows.filter((r) => r.placeholder);
const htmlWorkRows = htmlDataRows.filter((r) => !r.placeholder);
const dsByName = new Map(commands.map((c) => [c.command, c]));
const restoredMap = new Map((meta.repairedRows ?? []).map((r) => [r.command, r.restored]));

const comparison = {
  htmlDataRows: htmlDataRows.length,
  placeholderRows: placeholderRows.length,
  rowsCompared: 0,
  fieldsCompared: 0,
  badCellCount: [],
  mismatches: [],
  missingFromDataset: [],
  extraInDataset: [],
};
const htmlCommands = new Set();

for (const row of htmlWorkRows) {
  const command = row.cells[0]?.text ?? '';
  if (row.cells.length !== 4) {
    comparison.badCellCount.push({ command, cells: row.cells.length });
    continue;
  }
  comparison.rowsCompared++;
  htmlCommands.add(command);
  const [, dvCell, flagsCell, descCell] = row.cells.map((c) => c.text);
  const record = dsByName.get(command);
  if (!record) {
    comparison.missingFromDataset.push(command);
    continue;
  }
  const restored = restoredMap.get(command);
  const expected = {
    command,
    defaultValue: restored ? restored.defaultValue : dvCell === '' ? null : dvCell,
    flags: restored
      ? restored.flags.join(',')
      : [...new Set((flagsCell ?? '').split(',').map((f) => f.trim()).filter((f) => FLAG_SET.has(f)))].join(','),
    descriptionEn: restored ? restored.descriptionEn : (descCell ?? ''),
    section: row.section,
  };
  const actual = {
    command: record.command,
    defaultValue: record.defaultValue,
    flags: record.flags.join(','),
    descriptionEn: record.descriptionEn,
    section: record.section,
  };
  comparison.fieldsCompared += 5;
  for (const field of Object.keys(expected)) {
    if (JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) {
      comparison.mismatches.push({ command, field, html: expected[field], dataset: actual[field] });
    }
  }
}
for (const c of commands) if (!htmlCommands.has(c.command)) comparison.extraInDataset.push(c.command);

check(
  'F5: every HTML data row has exactly 4 cells',
  comparison.badCellCount.length === 0,
  JSON.stringify(comparison.badCellCount.slice(0, 5)).slice(0, 300)
);
check(
  'F5: html data rows = 2 placeholders + 2528 dataset rows',
  htmlDataRows.length === 2530 && comparison.placeholderRows === 2 && comparison.rowsCompared === commands.length,
  `htmlDataRows=${htmlDataRows.length} placeholders=${comparison.placeholderRows} compared=${comparison.rowsCompared} dataset=${commands.length}`
);
check(
  'F5: 2528 rows x 5 fields compared against the served HTML',
  comparison.fieldsCompared === commands.length * 5,
  `${comparison.fieldsCompared} vs ${commands.length * 5}`
);
check(
  'F5: no field mismatch between the HTML page and data/commands.json',
  comparison.mismatches.length === 0,
  comparison.mismatches.slice(0, 5).map((m) => `${m.command}.${m.field}: html=${JSON.stringify(m.html)} dataset=${JSON.stringify(m.dataset)}`).join(' | ')
);
check(
  'F5: no HTML row is missing from the dataset',
  comparison.missingFromDataset.length === 0,
  comparison.missingFromDataset.slice(0, 8).join(', ')
);
check(
  'F5: no dataset command is missing from the HTML page',
  comparison.extraInDataset.length === 0,
  comparison.extraInDataset.slice(0, 8).join(', ')
);
check(
  'F5: the placeholder rows stay out of the dataset',
  placeholderRows.every((r) => !dsByName.has(r.cells[0]?.text ?? '')),
  placeholderRows.map((r) => r.cells[0]?.text).join(', ')
);

/* ------------------------- source-defect ledger (defects that are in the wiki) */

const sourceDefects = meta.sourceDefects;
const defectEntries = sourceDefects?.entries ?? [];
check(
  'meta.sourceDefects.entries present (>= 5)',
  Array.isArray(defectEntries) && defectEntries.length >= 5,
  String(defectEntries.length)
);
check(
  'meta.sourceDefects.count matches entries',
  sourceDefects?.count === defectEntries.length,
  `${sourceDefects?.count} vs ${defectEntries.length}`
);
check(
  'every source-defect entry resolves to its chunk description (index + verbatim text)',
  defectEntries.every((e) => Number.isInteger(e.index) && seenIndices.get(e.index) === e.descriptionEn),
  (() => {
    const bad = defectEntries.find((e) => seenIndices.get(e.index) !== e.descriptionEn);
    return bad ? `offender: index ${bad.index}` : '';
  })()
);
const REPORTED_DEFECTS = [
  [805, 'Vertical offset for drawing the mesh (useful for flat planes'],
  [908, 'Flow through spawn groups for vis (0 == default'],
  [1008, "Changes's player's model"],
  [864, "this is the public facing ip address string: ('x.x.x.x' )"],
  [898, 'Play a recorded demo file (.dem ).'],
];
check(
  'the five translator-reported defects are registered verbatim',
  REPORTED_DEFECTS.every(([i, snippet]) => {
    const e = defectEntries.find((x) => x.index === i);
    return !!e && e.descriptionEn.includes(snippet);
  }),
  REPORTED_DEFECTS.filter(([i, s]) => {
    const e = defectEntries.find((x) => x.index === i);
    return !e || !e.descriptionEn.includes(s);
  })
    .map(([i]) => i)
    .join(', ')
);
check(
  'no duplicate (index, type) source-defect entries',
  new Set(defectEntries.map((e) => `${e.index}|${e.type}`)).size === defectEntries.length
);

// Independent re-scan of every chunk description with the same defect classes;
// both directions must agree, so a defect can neither be missed nor invented.
const RESCAN_RULES = [
  {
    type: 'unbalanced-bracket',
    detect: (t) => {
      for (const [o, c] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        const a = (t.match(new RegExp('\\' + o, 'g')) ?? []).length;
        const b = (t.match(new RegExp('\\' + c, 'g')) ?? []).length;
        if (a !== b) return `${o}x${a} ${c}x${b}`;
      }
      return null;
    },
  },
  { type: 'spacing-inside-parens', detect: (t) => (/\(\s|\s\)/.test(t) ? 'yes' : null) },
  { type: 'possessive-s', detect: (t) => (/\b[A-Za-z]{2,}s's\b/.test(t) ? 'yes' : null) },
  { type: 'duplicate-word', detect: (t) => (/\b([A-Za-z]{2,})\s+\1\b/i.test(t) ? 'yes' : null) },
  { type: 'missing-space-after-sentence', detect: (t) => (/[a-z]\.[A-Z][a-z]/.test(t) ? 'yes' : null) },
  { type: 'duplicate-punctuation', detect: (t) => (/(?<!\.)\.\.(?!\.)/.test(t) ? 'yes' : null) },
  { type: 'double-space', detect: (t) => (/  /.test(t) ? 'yes' : null) },
  { type: 'unbalanced-double-quote', detect: (t) => ((t.match(/"/g) ?? []).length % 2 === 1 ? 'yes' : null) },
];
const rescan = [];
for (const [i, d] of [...seenIndices].sort((a, b) => a[0] - b[0])) {
  for (const r of RESCAN_RULES) if (r.detect(d) !== null) rescan.push(`${i}|${r.type}`);
}
const registered = defectEntries.map((e) => `${e.index}|${e.type}`);
check(
  'no unregistered source defect (independent re-scan -> ledger)',
  rescan.every((k) => registered.includes(k)),
  rescan.filter((k) => !registered.includes(k)).join(', ')
);
check(
  'no phantom ledger entry (ledger -> independent re-scan)',
  registered.every((k) => rescan.includes(k)),
  registered.filter((k) => !rescan.includes(k)).join(', ')
);
check(
  'source-defect policy is documented for translators and reviewers',
  typeof sourceDefects?.policy === 'string' && sourceDefects.policy.includes('翻译'),
  ''
);

/* -------------------------------------------------------------------- out */

const passCount = results.filter((r) => r.ok).length;
console.log('verify-dataset: independent invariant check');
console.log(`  dataset : data/commands.json (${commands.length} commands)`);
console.log(`  chunks  : ${chunkFiles.length} files, ${allDescriptions.length} descriptions, indices 0..${indexKeys[indexKeys.length - 1]}`);
console.log(
  `  stage   : ${mergedCommands === 0 ? 'pre-merge (descriptionZh empty)' : `merged (descriptionZh filled ${mergedCommands}/${meta.withEnglishDescription}, unique translations ${new Set(commands.filter((c) => c.descriptionZh).map((c) => c.descriptionZh)).size})`}`
);
console.log('');
console.log('wiki corrupt-row audit');
console.log(`  html rows scanned        : ${htmlDataRows.length} (in ${htmlTables.length} standard-tables)`);
console.log(`  criterion A (nbsp+colon) : ${criterionA.length} -> ${namesOf(criterionA).join(', ')}`);
console.log(`  criterion B (bad flag)   : ${criterionB.length} -> ${namesOf(criterionB).join(', ')}`);
console.log(`  criterion C (misaligned) : ${criterionC.length} -> ${namesOf(criterionC).join(', ') || '(none)'}`);
console.log(`  full HTML<->dataset scan : ${comparison.rowsCompared}/${htmlDataRows.length} rows, ${comparison.fieldsCompared} fields, mismatches ${comparison.mismatches.length}, missing ${comparison.missingFromDataset.length}, extra ${comparison.extraInDataset.length}`);
console.log(`  enumerated in meta       : ${(meta.repairedRows ?? []).length} -> ${(meta.repairedRows ?? []).map((r) => r.command).sort().join(', ')}`);
for (const r of meta.repairedRows ?? []) {
  console.log(`    ${r.command}`);
  console.log(`      wiki cells : dv=${JSON.stringify(r.wikiCells.defaultValue)} flags=${JSON.stringify(r.wikiCells.flags)} desc=${JSON.stringify(r.wikiCells.description)}`);
  console.log(`      restored   : dv=${JSON.stringify(r.restored.defaultValue)} flags=[${r.restored.flags.join(', ')}] desc=${JSON.stringify(r.restored.descriptionEn)}`);
}
console.log(`  neighbours checked       : ${neighborReport.length}`);
for (const n of neighborReport) {
  console.log(`    ${n.subject} ${n.side} -> ${n.neighbor} [table ${n.table ?? '-'}] : ${n.status}${n.problems.length ? ' :: ' + n.problems.join('; ') : ''}`);
}
console.log('');
console.log('source-defect ledger (meta.sourceDefects)');
console.log(`  entries : ${defectEntries.length} (registered in meta)`);
console.log(`  rescan  : ${new Set(rescan).size} hits from the independent re-scan; unregistered = ${rescan.filter((k) => !registered.includes(k)).length}`);
for (const e of defectEntries) console.log(`    [${e.index}] ${e.type} :: ${JSON.stringify(e.descriptionEn)}`);
console.log('');
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.ok || !r.detail ? '' : `  <-- ${r.detail}`}`);
}
console.log('');
console.log(`RESULT: ${passCount}/${results.length} checks passed`);
console.log(
  failed === 0
    ? 'VERDICT: PASS — the dataset, the translation work units and the glossary satisfy the frozen contract.'
    : `VERDICT: FAIL — ${failed} check(s) failed.`
);
if (failed) process.exitCode = 1;
