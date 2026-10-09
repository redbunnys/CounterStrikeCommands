#!/usr/bin/env node
/**
 * 把 data/translation/parameter-tokens.md 的 82 条参数占位符释义，与 data/commands.json 里
 * **真实出现**的占位符做交叉核对，并生成前端常量文件 app/src/lib/placeholders.ts。
 *
 * 为什么要交叉核对：
 *  - markdown 表格位于表格单元格中，`|` 被转义成了 `\\|`，直接照抄会得到错误 token（数据里是 `\|`）。
 *  - 数据里的占位符写法才是唯一真相；表里没有的写法（例如把多个占位符并列成一个）需要按子占位符合成释义。
 *
 * 幂等：同样的输入生成完全相同的输出。用法：node app/scripts/inline-parameter-tokens.mjs [--check]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');
const datasetPath = resolve(projectRoot, 'data/commands.json');
const mdPath = resolve(projectRoot, 'data/translation/parameter-tokens.md');
const outPath = resolve(projectRoot, 'app/src/lib/placeholders.ts');
const checkOnly = process.argv.includes('--check');

const TOKEN_RE = /\{[^{}]*\}|<[^<>]*>|\[[^[\]]*\]/g;

/**
 * 归一化用于「查表」：源 HTML 里部分占位符内部用的是 NBSP（&#160;），
 * markdown 表格里则是普通空格，逐字比较会全部落空。运行时匹配仍使用数据里的原始写法。
 */
function normalizeToken(value) {
  return value.replace(/[\s\u00a0\u2007\u202f]+/g, ' ').trim();
}

// ---------------------------------------------------------------- 1. 数据里的真实占位符
const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
const counts = new Map();
const sampleCommands = new Map();
let occurrences = 0;
const commandsWithTokens = new Set();

for (const entry of dataset.commands) {
  for (const field of ['descriptionEn', 'descriptionZh']) {
    const text = entry[field] ?? '';
    if (text === '') continue;
    for (const token of text.match(TOKEN_RE) ?? []) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
      occurrences += 1;
      commandsWithTokens.add(entry.command);
      if (!sampleCommands.has(token)) sampleCommands.set(token, entry.command);
    }
  }
}

// ---------------------------------------------------------------- 2. markdown 表格
const md = readFileSync(mdPath, 'utf8');
const mdRows = [...md.matchAll(/^\|\s*`(.+?)`\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$/gm)].map((match) => ({
  token: match[1].replace(/\\\\\|/g, '\\|'), // 表格里的 `\\|` 是 MediaWiki/表格转义，数据里是 `\|`
  count: Number(match[2]),
  zh: match[3].replace(/\\\|/g, '|'),
}));
/** 归一化 token -> 释义，供数据侧容错查找 */
const mdByNormalizedToken = new Map();
for (const row of mdRows) {
  const key = normalizeToken(row.token);
  if (!mdByNormalizedToken.has(key)) mdByNormalizedToken.set(key, row.zh);
}

if (mdRows.length !== 82) {
  console.warn(`[warn] markdown 表格解析出 ${mdRows.length} 行，预期 82 行`);
}

// ---------------------------------------------------------------- 3. 合并
const OPENERS = new Set(['{', '<', '[']);
const CLOSERS = new Set(['}', '>', ']']);

function synthesize(token) {
  let inner = normalizeToken(token);
  if (OPENERS.has(inner.slice(0, 1))) inner = inner.slice(1);
  if (CLOSERS.has(inner.slice(-1))) inner = inner.slice(0, -1);
  // 数据里存在 `[<max distance>]` 这类「外层方括号 + 内层尖括号」写法，先整体查表
  for (const candidate of [inner, `{${inner}}`, `<${inner}>`, `[${inner}]`]) {
    const hit = mdByNormalizedToken.get(candidate);
    if (hit) return hit;
  }
  const parts = inner
    .split(/\s*[/|]\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const meanings = [];
  for (const part of parts) {
    const hit =
      mdByNormalizedToken.get(part) ??
      mdByNormalizedToken.get(`{${part}}`) ??
      mdByNormalizedToken.get(`<${part}>`) ??
      mdByNormalizedToken.get(`[${part}]`);
    if (!hit) return null;
    meanings.push(hit);
  }
  return meanings.length > 0 ? [...new Set(meanings)].join(' / ') : null;
}

const table = [];
const unresolved = [];
for (const [token, count] of counts) {
  const exact = mdByNormalizedToken.get(normalizeToken(token));
  const derived = exact ? null : synthesize(token);
  const zh = exact ?? derived;
  if (!zh) unresolved.push(token);
  table.push({
    token,
    zh: zh ?? '（译文中出现的中文变体，不是占位符）',
    count,
    source: exact ? 'glossary' : derived ? 'derived' : 'variant',
    sample: sampleCommands.get(token),
  });
}

table.sort((a, b) => b.token.length - a.token.length || (a.token < b.token ? -1 : 1));

const dataNormalized = new Set([...counts.keys()].map(normalizeToken));
const mdNotUsed = mdRows.filter((row) => !dataNormalized.has(normalizeToken(row.token)));
// ---------------------------------------------------------------- 4. 生成 TS
const lines = [];
lines.push('/**');
lines.push(' * 参数占位符中文释义表（自动生成，请勿手改）。');
lines.push(' *');
lines.push(' * 生成脚本：app/scripts/inline-parameter-tokens.mjs');
lines.push(' * 数据来源：data/translation/parameter-tokens.md（释义）+ data/commands.json（真实写法与出现次数）');
lines.push(' *');
lines.push(' * 规则（对 translator 与前端都生效）：');
lines.push(' *  - 占位符在 descriptionZh 中逐字保留英文原文，因为它们要能直接粘进 .cfg / 控制台。');
lines.push(' *  - `<t\\|ct>` 里的反斜杠是源站原文（MediaWiki 转义），属于正确数据：既不改写，也不清洗。');
lines.push(` *  - 当前数据集共 ${table.length} 种写法、${occurrences} 处出现，分布在 ${commandsWithTokens.size} 条命令的描述里；`);
lines.push(` *    其中 glossary ${table.filter((row) => row.source === 'glossary').length} 种、derived ${table.filter((row) => row.source === 'derived').length} 种、variant ${table.filter((row) => row.source === 'variant').length} 种。`);
lines.push(' *  - 译文中另有 1 种全角方括号变体（`［mod 作者使用］`，源自 `[mod authors use this]`，见 sv_disable_immunity_alpha）');
lines.push(' *    不在本脚本的扫描范围内（扫描只认 `[]`/`{}`/`<>` 半角括号）：**4 种译文变体合计影响 6 条命令**，');
lines.push(' *    它们都是描述性修饰语而非可复制参数，界面一律按普通文本显示、不加注解（详见 app/README 的裁定说明）。');
lines.push(' *  - 前端只做“展示层”的中文注解，绝不改写文本本身：renderPlaceholderSegments() 拼接后必须逐字等于原文。');
lines.push(' */');
lines.push('');
lines.push('export interface PlaceholderToken {');
lines.push('  /** 数据中出现的原始写法（逐字保留，含反斜杠） */');
lines.push('  token: string;');
lines.push('  /** 中文释义（tooltip / 行内注解用） */');
lines.push('  zh: string;');
lines.push('  /** 在 commands.json 描述里的出现次数（生成时统计） */');
lines.push('  count: number;');
lines.push('  /**');
lines.push('   * glossary = 与 parameter-tokens.md 精确对应；');
lines.push('   * derived  = 表格未直接收录，但由已收录的子占位符合成（如 `[<max distance>]`）；');
lines.push('   * variant  = 译文中出现的中文变体（不是占位符，界面不做注解）；');
lines.push('   */');
lines.push('  source: \'glossary\' | \'derived\' | \'variant\';');
lines.push('}');
lines.push('');
lines.push('/** 按长度降序排列，保证 `{class_name}` 之类的复合写法先于其子串被匹配。 */');
lines.push('export const PLACEHOLDER_TOKENS: PlaceholderToken[] = [');
for (const row of table) {
  lines.push(
    `  { token: ${JSON.stringify(row.token)}, zh: ${JSON.stringify(row.zh)}, count: ${row.count}, source: '${row.source}' },`,
  );
}
lines.push('];');
lines.push('');
lines.push('/** 运行时扫描用：把全部占位符按长度降序拼成一个锚定正则（无捕获组，便于 split）。 */');
lines.push('export const PLACEHOLDER_PATTERN: RegExp = new RegExp(');
lines.push('  PLACEHOLDER_TOKENS.map((entry) => entry.token.replace(/[.*+?^${}()|[\\]\\\\]/g, \'\\\\$&\')).join(\'|\'),');
lines.push('  \'g\',');
lines.push(');');
lines.push('');
lines.push('const MEANING = new Map(PLACEHOLDER_TOKENS.map((entry) => [entry.token, entry]));');
lines.push('');
lines.push('/** 查某个占位符的中文释义；未收录返回 undefined（界面只做原样展示） */');
lines.push('export function placeholderMeaning(token: string): string | undefined {');
lines.push('  return MEANING.get(token)?.zh;');
lines.push('}');
lines.push('');
lines.push('export type TextSegment =');
lines.push('  | { kind: \'text\'; text: string }');
lines.push('  | { kind: \'placeholder\'; text: string; zh: string; source: PlaceholderToken[\'source\'] };');
lines.push('');
lines.push('/**');
lines.push(' * 把描述切成「普通文本 / 占位符」片段，供 React 渲染 tooltip 与行内注解。');
lines.push(' * 不变式：segments.map(s => s.text).join(\'\') === input（逐字保留，含反斜杠与空格）。');
lines.push(' */');
lines.push('export function renderPlaceholderSegments(input: string): TextSegment[] {');
lines.push('  const text = input ?? \'\';');
lines.push('  if (text === \'\') return [];');
lines.push('  const segments: TextSegment[] = [];');
lines.push('  let lastIndex = 0;');
lines.push('  PLACEHOLDER_PATTERN.lastIndex = 0;');
lines.push('  let match: RegExpExecArray | null;');
lines.push('  while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {');
lines.push('    const token = match[0];');
lines.push('    if (match.index > lastIndex) {');
lines.push('      segments.push({ kind: \'text\', text: text.slice(lastIndex, match.index) });');
lines.push('    }');
lines.push('    const entry = MEANING.get(token);');
lines.push('    segments.push({');
lines.push('      kind: \'placeholder\',');
lines.push('      text: token,');
lines.push('      zh: entry?.zh ?? token,');
lines.push('      source: entry?.source ?? \'glossary\',');
lines.push('    });');
lines.push('    lastIndex = match.index + token.length;');
lines.push('    if (token.length === 0) PLACEHOLDER_PATTERN.lastIndex += 1;');
lines.push('  }');
lines.push('  if (lastIndex < text.length) segments.push({ kind: \'text\', text: text.slice(lastIndex) });');
lines.push('  return segments;');
lines.push('}');
lines.push('');
lines.push('/** 命中过占位符的文本里，占位符总数（用于统计与自测） */');
lines.push('export function countPlaceholders(input: string): number {');
lines.push('  PLACEHOLDER_PATTERN.lastIndex = 0;');
lines.push('  const matches = (input ?? \'\').match(PLACEHOLDER_PATTERN);');
lines.push('  return matches ? matches.length : 0;');
lines.push('}');
lines.push('');

const output = lines.join('\n');

if (checkOnly) {
  const existing = readFileSync(outPath, 'utf8');
  if (existing !== output) {
    console.error('[check] app/src/lib/placeholders.ts 与生成结果不一致，请重新运行生成脚本');
    process.exit(1);
  }
  console.log('[check] app/src/lib/placeholders.ts 与生成结果一致');
} else {
  writeFileSync(outPath, output, 'utf8');
}

console.log(`数据中真实出现的占位符：${table.length} 种 / ${occurrences} 处 / ${commandsWithTokens.size} 条命令`);
console.log(`markdown 表格：${mdRows.length} 行（其中 ${mdNotUsed.length} 行未在数据中出现：${mdNotUsed.map((row) => row.token).join(', ') || '无'}）`);
console.log(`按子占位符合成释义 / 兜底：${unresolved.length} 个 -> ${unresolved.join(', ') || '无'}`);
console.log(`反斜杠占位符：${JSON.stringify(table.filter((row) => row.token.includes('\\')).map((row) => [row.token, row.count]))}`);
console.log(`输出：${checkOnly ? '(check) ' : ''}${outPath}`);
