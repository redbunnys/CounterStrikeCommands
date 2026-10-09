#!/usr/bin/env node
/**
 * tools/guard-selftest.mjs — negative + regression tests for the corrupt-row guards.
 *
 * Every scenario runs against a throwaway copy of `tools/` + `data/` created with
 * `mkdtempSync(os.tmpdir())`; the real repository is never written to. The point is to
 * prove that the guards are NOT vacuous: each injected corruption must make the build
 * or the verifier fail *and name the offending row*.
 *
 * Scenarios
 *   baseline        unmodified copy: prepare-data must succeed, keep 2528 commands, and
 *                   still restore the four known wiki rows (no false positives on the
 *                   prose rows changelevel / map).
 *   nbsp-new-row    a new `&#160;:`-marked corrupt row appended to the raw parse must fail
 *                   (criterion A/B path).
 *   probe-bareflag  the verifier's t7 boundary probe (plain space, whitelisted Flags cell,
 *                   run-on segment without a flag name) appended to the raw parse must now
 *                   fail via the orthogonal misalignment guard.
 *   roundtrip       copy -> prepare-data -> merge-translations must reproduce the frozen
 *                   merged dataset byte for byte (proves tool changes are output-neutral).
 *   html-extra-row  a row present in the HTML but absent from the dataset must fail the
 *                   full HTML<->dataset comparison.
 *   html-bareflag   an HTML row whose Default Value cell is a bare flag token must fail the
 *                   misalignment criterion.
 *   html-badflag    an HTML row whose Flags cell carries a non-whitelisted token must fail
 *                   criterion B.
 *
 * Usage: node tools/guard-selftest.mjs
 * Exit 0 = every scenario behaved as expected.
 */
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_DATA = join(ROOT, 'data', 'commands.json');
const REAL_PUBLIC = join(ROOT, 'app', 'public', 'data', 'commands.json');

const EXPECTED_COMMANDS_PATTERN = /const EXPECTED_COMMANDS = 2528;/;

/** The verifier's t7 boundary probe, reproduced verbatim (README/t10 context). */
const PROBE = {
  id: 99998,
  command: 'zzz_verify_gap_probe',
  defaultValue: 'cl',
  flags: ['sv'],
  description: 'x] : Some description.',
  section: 'Z',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const results = [];
let failed = 0;
function expect(id, ok, detail) {
  results.push({ id, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id}${ok || !detail ? '' : `\n        ${detail}`}`);
}

function isolate(tag) {
  const dir = mkdtempSync(join(tmpdir(), `cs2-guard-${tag}-`));
  cpSync(join(ROOT, 'tools'), join(dir, 'tools'), { recursive: true });
  cpSync(join(ROOT, 'data'), join(dir, 'data'), { recursive: true });
  // the frontend runtime copy is part of the verified bundle; without it the verifier
  // would fail on an unrelated check and mask the scenario under test
  if (existsSync(join(ROOT, 'app', 'public'))) {
    cpSync(join(ROOT, 'app', 'public'), join(dir, 'app', 'public'), { recursive: true });
  }
  return dir;
}
function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}
function run(dir, script, args = []) {
  const res = spawnSync(process.execPath, [join(dir, 'tools', script), ...args], { cwd: dir, encoding: 'utf8' });
  return { code: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}
function bumpExpectedCommands(dir) {
  const p = join(dir, 'tools', 'prepare-data.mjs');
  const src = readFileSync(p, 'utf8');
  if (!EXPECTED_COMMANDS_PATTERN.test(src)) throw new Error('EXPECTED_COMMANDS anchor not found');
  writeFileSync(p, src.replace(EXPECTED_COMMANDS_PATTERN, 'const EXPECTED_COMMANDS = 2529;'), 'utf8');
}
function pushRawRow(dir, row) {
  const p = join(dir, 'data', 'cs2-commands.raw.json');
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  raw.commands.push(row);
  writeFileSync(p, JSON.stringify(raw, null, 2), 'utf8');
}
function editHtml(dir, mutate) {
  const p = join(dir, 'data', 'raw', 'cs2_wiki.html');
  const html = readFileSync(p, 'utf8');
  const next = mutate(html);
  if (next === html) throw new Error('HTML mutation did not apply');
  writeFileSync(p, next, 'utf8');
}
const datasetOf = (dir) => JSON.parse(readFileSync(join(dir, 'data', 'commands.json'), 'utf8'));

console.log('guard-selftest: negative + regression tests (isolated os.tmpdir() copies)\n');

/* ------------------------------------------------------------------ baseline */

{
  const dir = isolate('baseline');
  // The copy starts from the MERGED dataset. A bare run would hit the t12 destructive-rerun
  // guard and exit 1, masking what this scenario actually tests; --preserve-translations is
  // the normal invocation for an already merged tree.
  const res = run(dir, 'prepare-data.mjs', ['--preserve-translations']);
  const ds = datasetOf(dir);
  const byName = new Map(ds.commands.map((c) => [c.command, c]));
  const restore = [
    ['tv_broadcast_url', 'http://localhost:8080'],
    ['tv_broadcast_url1', 'http://localhost:8080'],
    ['cl_promoted_settings_acknowledged', '1696196680965'],
    ['sv_mapvetopickvote_phase_duration', '[1 | 5][2 | 15][3:20][4:10][5:10][6:5]'],
  ];
  expect('baseline: prepare-data exits 0 on unmodified input', res.code === 0, `exit=${res.code}\n${res.output.split('\n').filter((l) => /FAIL|BUILD FAILED/.test(l)).join('\n')}`);
  expect('baseline: 2528 commands', ds.commands.length === 2528, `got ${ds.commands.length}`);
  expect(
    'baseline: the four known wiki rows are still restored',
    restore.every(([cmd, value]) => byName.get(cmd)?.defaultValue === value),
    restore.filter(([cmd, value]) => byName.get(cmd)?.defaultValue !== value).map(([c]) => c).join(', ')
  );
  expect(
    'baseline: prose rows changelevel / map are not flagged (no false positive)',
    !ds.meta.unknownFlagTokens.some((u) => ['changelevel', 'map'].includes(u.command)) &&
      !(ds.meta.unhandledRunOnRows ?? []).some((u) => ['changelevel', 'map'].includes(u.command)),
    'changelevel/map were treated as corrupt'
  );
  const htmlRows = byName.get('map');
  expect('baseline: map keeps its prose description verbatim', !!htmlRows && htmlRows.descriptionEn === 'map <mapname> :Load a new map.', JSON.stringify(htmlRows?.descriptionEn));
  cleanup(dir);
}

/* ------------------------------------------- N4: new &#160;:-marked corrupt row */

{
  const dir = isolate('nbsp');
  bumpExpectedCommands(dir);
  pushRawRow(dir, {
    id: 99999,
    command: 'zzz_guard_nbsp_probe',
    defaultValue: 'http',
    flags: ['//localhost'],
    description: '8080 : release : URL of the relay',
    section: 'Z',
  });
  // --preserve-translations: the injected row must trip the corruption criteria, NOT the
  // destructive-rerun guard (the guard would fire first and mask the criterion under test)
  const res = run(dir, 'prepare-data.mjs', ['--preserve-translations']);
  expect(
    'nbsp-new-row: prepare-data fails and names the row',
    res.code !== 0 && res.output.includes('zzz_guard_nbsp_probe'),
    `exit=${res.code}\n${res.output.split('\n').filter((l) => /FAIL/.test(l)).join('\n')}`
  );
  cleanup(dir);
}

/* ----------------------------------- N3: the verifier's boundary probe (blind spot) */

{
  const dir = isolate('probe');
  bumpExpectedCommands(dir);
  pushRawRow(dir, PROBE);
  // same rule as above: use the normal (preserve) path so the corruption criteria are the
  // thing that fails, not the destructive-rerun guard
  const res = run(dir, 'prepare-data.mjs', ['--preserve-translations']);
  const accepted = res.code === 0;
  const ds = accepted ? datasetOf(dir) : null;
  const leaked = ds ? ds.commands.find((c) => c.command === PROBE.command) : null;
  expect(
    'probe-bareflag: prepare-data must NOT silently accept the verifier probe',
    !accepted,
    `exit=${res.code} (0 = silent acceptance)\nleaked row: ${JSON.stringify(leaked)}`
  );
  expect(
    'probe-bareflag: the failure names the probe row',
    !accepted && res.output.includes(PROBE.command),
    `exit=${res.code}\n${res.output.split('\n').filter((l) => /FAIL/.test(l)).join('\n')}`
  );
  if (accepted) {
    console.log(`        reproduction: probe accepted with defaultValue=${JSON.stringify(leaked?.defaultValue)} flags=${JSON.stringify(leaked?.flags)} descriptionEn=${JSON.stringify(leaked?.descriptionEn)}`);
  }
  cleanup(dir);
}

/* ------------------------- merged-tree guard (destructive rerun protection) */

{
  const dir = isolate('merged-refuse');
  const datasetPath = join(dir, 'data', 'commands.json');
  const chunkPath = join(dir, 'data', 'translation', 'chunks', 'chunk-001.json');
  const before = {
    data: sha256(readFileSync(datasetPath)),
    mtime: statSync(datasetPath).mtimeMs,
    chunks: sha256(readFileSync(chunkPath)),
  };
  const res = run(dir, 'prepare-data.mjs'); // no flags -> must refuse
  const after = {
    data: sha256(readFileSync(datasetPath)),
    mtime: statSync(datasetPath).mtimeMs,
    chunks: sha256(readFileSync(chunkPath)),
  };
  const mentionCount = /1587/.test(res.output);
  const mentionPhrase = /would silently destroy merged translations/.test(res.output);
  const mentionFlag = /--preserve-translations/.test(res.output) && /--reset-translations/.test(res.output);
  expect(
    'merged-refuse: prepare-data refuses on a merged tree (exit != 0)',
    res.code !== 0,
    `exit=${res.code}`
  );
  expect(
    'merged-refuse: the refusal says "would silently destroy merged translations"',
    mentionCount && mentionPhrase,
    `phrase=${mentionPhrase} count=${mentionCount}\n${res.output.split('\n').slice(0, 10).join('\n')}`
  );
  expect(
    'merged-refuse: the refusal offers the safe switches and reports the count',
    mentionCount && mentionFlag,
    `mentions count=${mentionCount} switches=${mentionFlag}`
  );
  expect(
    'merged-refuse: nothing was written (dataset + chunks byte-identical, mtime untouched)',
    before.data === after.data && before.mtime === after.mtime && before.chunks === after.chunks,
    `data ${before.data.slice(0, 12)}->${after.data.slice(0, 12)} mtime ${before.mtime}->${after.mtime}`
  );
  if (res.output.trim()) {
    console.log(res.output.trim().split('\n').map((l) => `        | ${l}`).join('\n'));
  }
  cleanup(dir);
}

{
  const dir = isolate('merged-preserve');
  const datasetPath = join(dir, 'data', 'commands.json');
  const before = { hash: sha256(readFileSync(datasetPath)), mtime: statSync(datasetPath).mtimeMs };
  const res = run(dir, 'prepare-data.mjs', ['--preserve-translations']);
  const after = { hash: sha256(readFileSync(datasetPath)), mtime: statSync(datasetPath).mtimeMs };
  expect(
    'merged-preserve: --preserve-translations exits 0 on a merged tree',
    res.code === 0,
    `exit=${res.code}\n${res.output.split('\n').filter((l) => /FAIL|BUILD FAILED/.test(l)).join('\n')}`
  );
  expect(
    'merged-preserve: translations survive byte-for-byte (dataset unchanged, mtime untouched)',
    before.hash === after.hash && before.mtime === after.mtime && before.hash === sha256(readFileSync(REAL_DATA)),
    `hash ${before.hash.slice(0, 12)}->${after.hash.slice(0, 12)} mtime ${before.mtime}->${after.mtime}`
  );
  cleanup(dir);
}

{
  const dir = isolate('clean-default-run');
  rmSync(join(dir, 'data', 'commands.json'), { force: true });
  const res = run(dir, 'prepare-data.mjs'); // no flags, but there is nothing to lose
  const ds = res.code === 0 ? datasetOf(dir) : null;
  expect(
    'clean-default-run: a tree without translations still builds with no flags',
    res.code === 0 && ds?.commands.length === 2528 && ds.commands.every((c) => c.descriptionZh === ''),
    `exit=${res.code} commands=${ds?.commands.length}`
  );
  cleanup(dir);
}

/* ------------------------- roundtrip: tool changes must be output-neutral */

{
  const dir = isolate('roundtrip');
  // Deliberate exception to the "normal path uses --preserve-translations" rule: this
  // scenario must prove the REAL prepare -> merge rebuild reproduces the frozen artifact
  // from a clean pre-merge input, so the translations have to be dropped first. The
  // explicit --reset-translations also disables the destructive-rerun guard, so nothing
  // is masked here.
  const prep = run(dir, 'prepare-data.mjs', ['--reset-translations']);
  const merge = prep.code === 0 ? run(dir, 'merge-translations.mjs') : { code: -1, output: 'skipped (prepare failed)' };
  const copyData = join(dir, 'data', 'commands.json');
  const copyPublic = join(dir, 'app', 'public', 'data', 'commands.json');
  const realHash = sha256(readFileSync(REAL_DATA));
  const copyHash = sha256(readFileSync(copyData));
  expect('roundtrip: prepare-data --reset-translations + merge both succeed', prep.code === 0 && merge.code === 0, `prepare=${prep.code} merge=${merge.code}\n${merge.output.split('\n').filter((l) => /FAIL/.test(l)).join('\n')}`);
  expect(
    'roundtrip: merged dataset is byte-identical to the frozen artifact',
    copyHash === realHash,
    `copy=${copyHash}\nreal=${realHash}`
  );
  expect(
    'roundtrip: frontend copy is byte-identical to the frozen artifact',
    sha256(readFileSync(copyPublic)) === sha256(readFileSync(REAL_PUBLIC)),
    'frontend copy differs'
  );
  cleanup(dir);
}

/* ------------------------------------------------- F5 / criterion C / B on the HTML */

{
  const dir = isolate('html-extra');
  editHtml(dir, (html) => {
    const anchor = '<tr>\n<td>cl_quickinventory_filename</td>';
    const idx = html.indexOf(anchor);
    if (idx < 0) throw new Error('anchor row not found');
    const injected = '<tr>\n<td>zzz_html_extra_row</td>\n<td>1</td>\n<td>cl, release</td>\n<td>Injected row that exists only in the HTML.</td></tr>\n';
    return html.slice(0, idx) + injected + html.slice(idx);
  });
  const res = run(dir, 'verify-dataset.mjs');
  expect(
    'html-extra-row: verify-dataset fails on a row missing from the dataset',
    res.code !== 0 && res.output.includes('zzz_html_extra_row'),
    `exit=${res.code}\n${res.output.split('\n').filter((l) => /FAIL/.test(l)).join('\n')}`
  );
  cleanup(dir);
}

{
  const dir = isolate('html-bareflag');
  editHtml(dir, (html) =>
    html.replace('<td>teammenu</td>\n<td>cmd</td>', '<td>teammenu</td>\n<td>cl</td>')
  );
  const res = run(dir, 'verify-dataset.mjs');
  expect(
    'html-bareflag: verify-dataset fails when an HTML Default Value cell is a bare flag token',
    res.code !== 0 && /misalign|bare engine-flag/i.test(res.output),
    `exit=${res.code}\n${res.output.split('\n').filter((l) => /FAIL/.test(l)).join('\n')}`
  );
  cleanup(dir);
}

{
  const dir = isolate('html-badflag');
  editHtml(dir, (html) =>
    html.replace('<td>teammenu</td>\n<td>cmd</td>\n<td>cl, server_can_execute</td>', '<td>teammenu</td>\n<td>cmd</td>\n<td>cl, not_a_flag</td>')
  );
  const res = run(dir, 'verify-dataset.mjs');
  expect(
    'html-badflag: verify-dataset fails on a non-whitelisted Flags token',
    res.code !== 0 && /criterion B|not_a_flag/i.test(res.output),
    `exit=${res.code}\n${res.output.split('\n').filter((l) => /FAIL/.test(l)).join('\n')}`
  );
  cleanup(dir);
}

/* -------------------------------------------------------------------- summary */

const passCount = results.filter((r) => r.ok).length;
console.log(`\nRESULT: ${passCount}/${results.length} guard-selftest scenarios behaved as expected`);
if (failed) {
  console.log('VERDICT: FAIL — the guard is vacuous or over-eager for at least one scenario.');
  process.exitCode = 1;
} else {
  console.log('VERDICT: PASS — every injected corruption fails loudly, every clean case stays green.');
}
