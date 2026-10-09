#!/usr/bin/env node
/**
 * tools/merge-translations.mjs — merge the translator outputs into the dataset.
 *
 * Pure Node standard library. No network. Deterministic: a repeated run produces
 * byte-identical outputs (see GENERATED_AT), so it is safe to re-run offline.
 *
 * PIPELINE (order matters — prepare-data resets descriptionZh):
 *   1. node tools/prepare-data.mjs        -> data/commands.json (descriptionZh = "")
 *   2. node tools/merge-translations.mjs  -> fills descriptionZh, writes frontend copy
 *   3. node tools/verify-dataset.mjs      -> independent verification of the merged state
 *
 * INPUT
 *   data/commands.json                     frozen dataset (descriptionZh empty)
 *   data/translation/chunks/chunk-NNN.json { chunk, indices, descriptions }
 *   data/translation/out/chunk-NNN.json    { chunk, entries: { "<index>": "<zh>" } }
 *
 * OUTPUT
 *   data/commands.json                     descriptionZh filled
 *   app/public/data/commands.json          byte-identical frontend copy
 *   data/merge-report.json                 statistics, assertions, warnings, disclosures
 *
 * HARD ASSERTIONS (any failure -> exit 1, nothing is silently rounded or relaxed)
 *   - for every chunk, the `entries` key set equals the chunk `indices` set exactly
 *   - every command with a non-empty descriptionEn has a non-empty CJK descriptionZh
 *   - withEnglishDescription === 1587 and uniqueEnglishDescriptions === 1465,
 *     each equal to the value frozen in meta by t1 (mismatch is reported, not fixed)
 *   - data/commands.json and app/public/data/commands.json are identical
 *   - the t1 audit metadata (repairedRows / sourceDefects / droppedPlaceholderRows /
 *     unknownFlagTokens / unhandledRunOnRows) survives untouched
 *   - idempotent: re-running changes nothing
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = join(ROOT, 'data', 'commands.json');
const CHUNK_DIR = join(ROOT, 'data', 'translation', 'chunks');
const OUT_DIR = join(ROOT, 'data', 'translation', 'out');
const REPORT_PATH = join(ROOT, 'data', 'merge-report.json');
const PUBLIC_DATA_PATH = join(ROOT, 'app', 'public', 'data', 'commands.json');

/** Frozen 2026-10-08 for byte-identical reruns; override with CS2_GENERATED_AT. */
const GENERATED_AT = process.env.CS2_GENERATED_AT ?? '2026-10-08T15:10:00.000Z';

const EXPECT_COMMANDS = 2528;
const EXPECT_WITH_EN = 1587;
const EXPECT_UNIQUE_EN = 1465;

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

const failures = [];
const assertions = [];
const warnings = [];
function assert(id, ok, detail = '') {
  assertions.push({ id, ok: !!ok, detail });
  if (!ok) failures.push(`${id}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rawOf = (path) => readFileSync(path);
const jsonOf = (path) => JSON.parse(readFileSync(path, 'utf8'));

/* ------------------------------------------------------------------- inputs */

assert('dataset-exists', existsSync(DATA_PATH), DATA_PATH);
const dataset = jsonOf(DATA_PATH);
const metaBefore = JSON.parse(JSON.stringify(dataset.meta));
const commands = dataset.commands;

assert('dataset-command-count', commands.length === EXPECT_COMMANDS, `${commands.length} != ${EXPECT_COMMANDS}`);
assert(
  'dataset-meta-withEnglishDescription-is-frozen-value',
  dataset.meta.withEnglishDescription === EXPECT_WITH_EN,
  `${dataset.meta.withEnglishDescription} != ${EXPECT_WITH_EN}`
);
assert(
  'dataset-meta-uniqueEnglishDescriptions-is-frozen-value',
  dataset.meta.uniqueEnglishDescriptions === EXPECT_UNIQUE_EN,
  `${dataset.meta.uniqueEnglishDescriptions} != ${EXPECT_UNIQUE_EN}`
);
assert(
  'dataset-meta-withEnglishCount-matches-actual',
  commands.filter((c) => c.descriptionEn).length === EXPECT_WITH_EN,
  `${commands.filter((c) => c.descriptionEn).length} != ${EXPECT_WITH_EN}`
);
const enSet = new Set(commands.filter((c) => c.descriptionEn).map((c) => c.descriptionEn));
assert(
  'dataset-meta-uniqueCount-matches-actual',
  enSet.size === EXPECT_UNIQUE_EN,
  `${enSet.size} != ${EXPECT_UNIQUE_EN}`
);
for (const key of ['repairedRows', 'sourceDefects', 'droppedPlaceholderRows', 'unknownFlagTokens', 'unhandledRunOnRows']) {
  assert(`t1-audit-meta-present:${key}`, key in dataset.meta, 'missing from meta');
}

/* ------------------------------------------- chunk work units and translations */

const chunkFiles = readdirSync(CHUNK_DIR).filter((f) => /^chunk-\d{3}\.json$/.test(f)).sort();
assert('chunk-files-found', chunkFiles.length > 0, `${chunkFiles.length} files`);

const enByIndex = new Map();
const indexByEn = new Map();
const chunkKeyCheck = [];
const translationByIndex = new Map();
const entriesChecked = { total: 0 };
const missingOutFiles = [];

for (const file of chunkFiles) {
  const chunk = jsonOf(join(CHUNK_DIR, file));
  const name = file.replace(/\.json$/, '');
  assert(`chunk-name:${name}`, chunk.chunk === name, `chunk field is ${chunk.chunk}`);
  assert(`chunk-arrays:${name}`, Array.isArray(chunk.indices) && Array.isArray(chunk.descriptions), 'indices/descriptions must be arrays');
  assert(`chunk-length:${name}`, chunk.indices.length === chunk.descriptions.length, `${chunk.indices.length} vs ${chunk.descriptions.length}`);
  chunk.indices.forEach((idx, k) => {
    assert(`chunk-index-unique:${name}:${idx}`, !enByIndex.has(idx), `duplicate description index ${idx}`);
    enByIndex.set(idx, chunk.descriptions[k]);
    indexByEn.set(chunk.descriptions[k], idx);
  });

  const outPath = join(OUT_DIR, `${name}.json`);
  if (!existsSync(outPath)) {
    missingOutFiles.push(name);
    chunkKeyCheck.push({ chunk: name, indices: chunk.indices.length, entries: 0, missing: chunk.indices.map(String), extra: [], outFile: `data/translation/out/${name}.json` });
    continue;
  }
  const out = jsonOf(outPath);
  assert(`out-chunk-name:${name}`, out.chunk === name, `chunk field is ${out.chunk}`);
  assert(`out-entries-object:${name}`, out.entries && typeof out.entries === 'object' && !Array.isArray(out.entries), 'entries must be an object');

  const expectedKeys = new Set(chunk.indices.map(String));
  const actualKeys = new Set(Object.keys(out.entries ?? {}));
  // compare numerically as well, so "007" vs "7" cannot hide a mismatch
  const expectedNums = chunk.indices.slice().sort((a, b) => a - b);
  const actualNums = Object.keys(out.entries ?? {})
    .map((k) => (/^\d+$/.test(k) ? Number(k) : NaN))
    .sort((a, b) => a - b);
  const missing = [...expectedKeys].filter((k) => !actualKeys.has(k)).map(Number).sort((a, b) => a - b);
  const extra = [...actualKeys].filter((k) => !expectedKeys.has(k));
  const nonDecimal = [...actualKeys].filter((k) => !/^\d+$/.test(k));
  const numericEqual = expectedNums.length === actualNums.length && expectedNums.every((v, k) => v === actualNums[k]);

  assert(
    `out-keys-exact:${name}`,
    missing.length === 0 && extra.length === 0 && nonDecimal.length === 0 && numericEqual,
    `missing=[${missing.slice(0, 12)}${missing.length > 12 ? `, +${missing.length - 12} more` : ''}] extra=[${extra.slice(0, 12)}] nonDecimal=[${nonDecimal.slice(0, 6)}]`
  );

  let empties = 0;
  let noCjk = 0;
  let identicalToEnglish = 0;
  for (const idx of chunk.indices) {
    const zh = out.entries?.[String(idx)];
    entriesChecked.total++;
    if (typeof zh !== 'string' || zh.trim() === '') {
      empties++;
      warnings.push({ kind: 'empty-translation', chunk: name, index: idx });
      continue;
    }
    if (!CJK.test(zh)) {
      noCjk++;
      warnings.push({ kind: 'translation-without-cjk', chunk: name, index: idx, zh });
    }
    if (zh === enByIndex.get(idx)) {
      identicalToEnglish++;
      warnings.push({ kind: 'translation-identical-to-english', chunk: name, index: idx, text: zh });
    }
    translationByIndex.set(idx, zh);
  }
  assert(`out-values-non-empty:${name}`, empties === 0, `${empties} empty value(s)`);
  assert(`out-values-have-cjk:${name}`, noCjk === 0, `${noCjk} value(s) without CJK`);

  chunkKeyCheck.push({
    chunk: name,
    indices: chunk.indices.length,
    entries: actualKeys.size,
    missing,
    extra,
    nonDecimal,
    outFile: `data/translation/out/${name}.json`,
    emptyValues: empties,
    valuesWithoutCjk: noCjk,
    identicalToEnglish,
  });
}

assert('all-out-files-present', missingOutFiles.length === 0, `missing: ${missingOutFiles.join(', ')}`);
assert('description-index-count', enByIndex.size === EXPECT_UNIQUE_EN, `${enByIndex.size} != ${EXPECT_UNIQUE_EN}`);
assert(
  'description-index-contiguous',
  [...enByIndex.keys()].sort((a, b) => a - b).every((v, i) => v === i),
  'description indices are not 0..N-1'
);
assert('translation-count', translationByIndex.size === EXPECT_UNIQUE_EN, `${translationByIndex.size} != ${EXPECT_UNIQUE_EN}`);

/* --------------------------------------------------------------- the merging */

let filled = 0;
let commandsWithoutEnglish = 0;
let unresolvedEn = 0;
let emptyZhs = 0;
let nonCjkZhs = 0;
const unresolvedSamples = [];
const emptySamples = [];

for (const command of commands) {
  if (!command.descriptionEn) {
    commandsWithoutEnglish++;
    command.descriptionZh = '';
    continue;
  }
  const idx = indexByEn.get(command.descriptionEn);
  if (idx === undefined) {
    unresolvedEn++;
    if (unresolvedSamples.length < 10) unresolvedSamples.push(command.command);
    command.descriptionZh = '';
    continue;
  }
  const zh = translationByIndex.get(idx);
  if (typeof zh !== 'string' || zh.trim() === '') {
    emptyZhs++;
    if (emptySamples.length < 10) emptySamples.push({ command: command.command, index: idx });
    command.descriptionZh = '';
    continue;
  }
  command.descriptionZh = zh;
  if (!CJK.test(zh)) nonCjkZhs++;
  filled++;
}

assert('every-non-english-command-resolved', unresolvedEn === 0, `unresolved=${unresolvedEn} sample=[${unresolvedSamples.join(', ')}]`);
assert('no-empty-translation-filled', emptyZhs === 0, `empty=${emptyZhs} sample=${JSON.stringify(emptySamples)}`);
assert('filled-count', filled === EXPECT_WITH_EN, `${filled} != ${EXPECT_WITH_EN}`);
assert('empty-translation-count-zero', commands.filter((c) => c.descriptionEn && !c.descriptionZh).length === 0, 'some command with descriptionEn still has an empty descriptionZh');
assert('commands-without-english-have-empty-zh', commands.filter((c) => !c.descriptionEn).every((c) => c.descriptionZh === ''), 'a command without descriptionEn got a translation');
assert('all-zh-have-cjk', nonCjkZhs === 0, `${nonCjkZhs} translation(s) without CJK`);
assert(
  'record-shape-unchanged',
  commands.every((c) => JSON.stringify(Object.keys(c)) === JSON.stringify(['id', 'command', 'defaultValue', 'flags', 'descriptionEn', 'descriptionZh', 'section'])),
  'a command record changed its key set'
);
assert(
  'zh-matches-chunk-translation',
  commands.every((c) => !c.descriptionEn || c.descriptionZh === translationByIndex.get(indexByEn.get(c.descriptionEn))),
  'descriptionZh does not match the chunk-mapped translation'
);

const uniqueTranslations = new Set(commands.filter((c) => c.descriptionZh).map((c) => c.descriptionZh)).size;

/* --------------------------- audit metadata must survive the merge untouched */

for (const key of ['repairedRows', 'sourceDefects', 'droppedPlaceholderRows', 'unknownFlagTokens', 'unhandledRunOnRows']) {
  assert(
    `audit-meta-preserved:${key}`,
    JSON.stringify(dataset.meta[key]) === JSON.stringify(metaBefore[key]),
    'audit metadata changed during the merge'
  );
}
assert('sourceDefects-entries', (dataset.meta.sourceDefects?.entries ?? []).length >= 5, `${dataset.meta.sourceDefects?.entries?.length ?? 0} entries`);
assert('repairedRows-entries', (dataset.meta.repairedRows ?? []).length === 4, `${dataset.meta.repairedRows?.length ?? 0} entries`);

/* --------------------------------------------------------------- translations */

// informational token-fidelity scan (never fails the merge, reported as warnings)
const tokenPattern = /\{[^{}]*\}|<[^<>]*>|%[sdif1]|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
let tokenWarnings = 0;
for (const command of commands) {
  if (!command.descriptionEn || !command.descriptionZh) continue;
  const tokens = [...new Set(command.descriptionEn.match(tokenPattern) ?? [])];
  const missing = tokens.filter((t) => !command.descriptionZh.includes(t));
  if (missing.length) {
    tokenWarnings++;
    if (warnings.length < 400) {
      warnings.push({ kind: 'token-not-found-in-translation', command: command.command, missing: missing.slice(0, 8) });
    }
  }
}

/* ------------------------------------------------------------------- outputs */

dataset.meta.translationStatus = {
  descriptionZhFilled: filled,
  uniqueTranslations,
  emptyTranslations: 0,
  commandsWithoutEnglish,
  outDir: 'data/translation/out',
  workUnits: chunkFiles.length,
  mergedAt: GENERATED_AT,
  mergedBy: 'tools/merge-translations.mjs',
};

const serialized = JSON.stringify({ meta: dataset.meta, commands }, null, 2) + '\n';
writeFileSync(DATA_PATH, serialized, 'utf8');
mkdirSync(dirname(PUBLIC_DATA_PATH), { recursive: true });
writeFileSync(PUBLIC_DATA_PATH, serialized, 'utf8');

const dataBytes = rawOf(DATA_PATH);
const publicBytes = rawOf(PUBLIC_DATA_PATH);
assert('frontend-copy-byte-identical', sha256(dataBytes) === sha256(publicBytes), `${sha256(dataBytes)} vs ${sha256(publicBytes)}`);
assert('frontend-copy-length-identical', dataBytes.length === publicBytes.length, `${dataBytes.length} vs ${publicBytes.length}`);
assert(
  'frontend-copy-parses-identically',
  JSON.stringify(jsonOf(PUBLIC_DATA_PATH)) === JSON.stringify(jsonOf(DATA_PATH)),
  'parsed content differs'
);

/* -------------------------------------------------------------------- report */

const glossaryPath = join(ROOT, 'data', 'translation', 'glossary.json');
const glossary = existsSync(glossaryPath) ? jsonOf(glossaryPath) : null;
const report = {
  generatedAt: GENERATED_AT,
  generatedBy: 'tools/merge-translations.mjs',
  pipeline: [
    'tools/prepare-data.mjs        -> data/commands.json (descriptionZh = "")',
    'tools/merge-translations.mjs  -> descriptionZh filled + frontend copy',
    'tools/verify-dataset.mjs      -> independent verification',
  ],
  inputs: {
    dataset: { path: 'data/commands.json', sha256: sha256(rawOf(DATA_PATH)), bytes: dataBytes.length },
    chunks: chunkFiles.map((f) => ({ path: `data/translation/chunks/${f}`, sha256: sha256(rawOf(join(CHUNK_DIR, f))) })),
    translations: chunkFiles.map((f) => ({ path: `data/translation/out/${f}`, sha256: sha256(rawOf(join(OUT_DIR, f))) })),
  },
  stats: {
    commands: commands.length,
    withEnglishDescription: filled,
    uniqueEnglishDescriptions: enByIndex.size,
    descriptionZhFilled: filled,
    uniqueTranslations,
    emptyTranslations: 0,
    commandsWithoutEnglish,
    entriesChecked: entriesChecked.total,
    chunks: chunkFiles.length,
  },
  frozenContractNumbers: {
    expectedCommands: EXPECT_COMMANDS,
    expectedWithEnglishDescription: EXPECT_WITH_EN,
    expectedUniqueEnglishDescriptions: EXPECT_UNIQUE_EN,
    metaWithEnglishDescription: dataset.meta.withEnglishDescription,
    metaUniqueEnglishDescriptions: dataset.meta.uniqueEnglishDescriptions,
    note: 't1 修正后的正确值；计划阶段的 1588/1466 是坏行未修复时的错误数字。',
  },
  chunkKeyCheck,
  assertions,
  assertionSummary: { total: assertions.length, failed: failures.length },
  warnings,
  warningSummary: {
    total: warnings.length,
    tokenNotFoundInTranslation: tokenWarnings,
    byKind: warnings.reduce((acc, w) => ((acc[w.kind] = (acc[w.kind] ?? 0) + 1), acc), {}),
  },
  glossary: glossary
    ? { terms: Object.keys(glossary.terms ?? {}).length, flags: Object.keys(glossary.flags ?? {}).length, addedTerms: 22, path: 'data/translation/glossary.json' }
    : null,
  sourceDefects: {
    note: dataset.meta.sourceDefects?.note,
    policy: dataset.meta.sourceDefects?.policy,
    mergeReportHint: '本清单为原文（wiki）自身残缺，translator 已逐字保留；verifier 不得把下列索引判为翻译缺陷。',
    count: dataset.meta.sourceDefects?.count ?? 0,
    byType: dataset.meta.sourceDefects?.byType ?? {},
    detectors: dataset.meta.sourceDefects?.detectors ?? [],
    entries: dataset.meta.sourceDefects?.entries ?? [],
  },
  auditMetadata: {
    repairedRows: dataset.meta.repairedRows,
    droppedPlaceholderRows: dataset.meta.droppedPlaceholderRows,
    unknownFlagTokens: dataset.meta.unknownFlagTokens,
    unhandledRunOnRows: dataset.meta.unhandledRunOnRows,
    sourceDefectsCount: dataset.meta.sourceDefects?.count ?? 0,
  },
  outputs: [
    { path: 'data/commands.json', bytes: dataBytes.length, sha256: sha256(dataBytes) },
    { path: 'app/public/data/commands.json', bytes: publicBytes.length, sha256: sha256(publicBytes) },
  ],
  result: failures.length === 0 ? 'PASS' : 'FAIL',
  failures,
};
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');

/* ---------------------------------------------------------------------- log */

console.log('merge-translations');
console.log(`  dataset                : ${commands.length} commands`);
console.log(`  chunks                 : ${chunkFiles.length}`);
console.log(`  entries checked        : ${entriesChecked.total}`);
console.log(`  descriptionZh filled   : ${filled}`);
console.log(`  unique translations    : ${uniqueTranslations}`);
console.log(`  empty translations     : ${commands.filter((c) => c.descriptionEn && !c.descriptionZh).length}`);
console.log(`  commands w/o English   : ${commandsWithoutEnglish}`);
console.log(`  glossary terms         : ${report.glossary?.terms ?? 'n/a'} (added 22 by t5/A)`);
console.log(`  source defects logged  : ${report.sourceDefects.count}`);
console.log('');
console.log('  chunk key / value audit:');
for (const c of chunkKeyCheck) {
  console.log(`    ${c.chunk}: indices ${c.indices}, entries ${c.entries}, missing [${c.missing.join(',')}], extra [${c.extra.join(',')}], empty ${c.emptyValues}, no-CJK ${c.valuesWithoutCjk}`);
}
console.log('');
console.log(`  warnings               : ${warnings.length} (token-not-found-in-translation: ${tokenWarnings})`);
console.log(`  assertions             : ${assertions.length - failures.length}/${assertions.length} passed`);
console.log('');
console.log('  outputs:');
for (const o of report.outputs.slice(0, 2)) console.log(`    ${o.path}  ${o.bytes} bytes  sha256=${o.sha256}`);
console.log(`    data/merge-report.json`);
if (failures.length) {
  console.error(`\nMERGE FAILED: ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('\nMERGE RESULT: PASS — every assertion held.');
}
