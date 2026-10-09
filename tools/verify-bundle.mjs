#!/usr/bin/env node
/**
 * tools/verify-bundle.mjs — 独立验证器（verifier 角色，t7）
 *
 * 目的：用**独立实现**的校验程序发现真实缺陷，而不是复述构建者自己的断言。
 * 约束遵守：
 *   - 纯 Node 标准库；不访问外网（只访问本机回环上的自建/预览服务）。
 *   - **不 import / 不复用** tools/prepare-data.mjs、tools/parse-commands.mjs、
 *     tools/verify-parse.mjs、tools/verify-dataset.mjs、tools/merge-translations.mjs。
 *     这些文件只被「阅读」以理解 schema 与检查逻辑；本文件的每一条断言都是重写的。
 *   - 唯一例外（有意为之）：为了让「前端纯函数行为」有独立参照，本脚本用 Node 原生
 *     类型擦除直接 import `app/src/lib/filter.ts` / `copy.ts` **被测代码本体**，
 *     同时再用自己重写的实现交叉验证（见 S8）。
 *   - 只写 tools/verify-bundle.mjs、data/verify-bundle.txt、data/verify-bundle.json。
 *     隔离副本与负向测试全部落在 os.tmpdir() 下，绝不污染真实数据。
 *
 * 运行：node tools/verify-bundle.mjs
 * 选项：CS2_SEED=<int>         随机抽样种子（默认 20261008，保证可复现）
 *       CS2_SKIP_FRONTEND=1    跳过前端构建/浏览器段（--skip-frontend 等价）
 *       CS2_SKIP_NEGATIVE=1    跳过隔离负向测试（--skip-negative 等价）
 *       --harness-only         只跑「同源 harness + Chrome」这一段并打印原始回传（调试用；
 *                              CS2_HARNESS_FILE / CS2_DEBUG_URL / CS2_CHROME_FLAGS / CS2_CHROME_TIMEOUT 可覆盖参数）
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync, cpSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import net from 'node:net';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = join(ROOT, 'data', 'raw', 'cs2_wiki.html');
const DATA_PATH = join(ROOT, 'data', 'commands.json');
const COPY_PATH = join(ROOT, 'app', 'public', 'data', 'commands.json');
const DIST_DATA_PATH = join(ROOT, 'dist', 'data', 'commands.json');
const TOKENS_MD_PATH = join(ROOT, 'data', 'translation', 'parameter-tokens.md');
const REPORT_TXT = join(ROOT, 'data', 'verify-bundle.txt');
const REPORT_JSON = join(ROOT, 'data', 'verify-bundle.json');

const ARGV = process.argv.slice(2);
const SKIP_FRONTEND = process.env.CS2_SKIP_FRONTEND === '1' || ARGV.includes('--skip-frontend');
const SKIP_NEGATIVE = process.env.CS2_SKIP_NEGATIVE === '1' || ARGV.includes('--skip-negative');
const SEED = Number(process.env.CS2_SEED ?? 20261008);

const FLAG_WHITELIST = [
  'sv', 'cl', 'rep', 'cheat', 'release', 'nf', 'a', 'per_user', 'user', 'norecord', 'sp', 'demo',
  'nolog', 'server_can_execute', 'clientcmd_can_execute', 'vconsole_fuzzy', 'vconsole_set_focus',
  'server_cant_query', 'prot', 'execute_per_tick', 'disconnected',
];
const FLAG_SET = new Set(FLAG_WHITELIST);
const FIELDS = ['id', 'command', 'defaultValue', 'flags', 'descriptionEn', 'descriptionZh', 'section'];
const EXPECTED_COMMANDS = 2528;
const EXPECTED_WITH_EN = 1587;
const EXPECTED_UNIQUE_EN = 1465;
const EXPECTED_DIST_SHA = 'c6ce50e8b41567911926e22cff25a4f060befa058debffd4a6ebb4c0160673a1';
const EXPECTED_REPAIRS = {
  tv_broadcast_url: 'http://localhost:8080',
  tv_broadcast_url1: 'http://localhost:8080',
  cl_promoted_settings_acknowledged: '1696196680965',
  sv_mapvetopickvote_phase_duration: '[1 | 5][2 | 15][3:20][4:10][5:10][6:5]',
};

/* ------------------------------------------------------------------ framework */

const LOG = [];
let currentSection = '(init)';
const checks = [];
const unverified = [];
const samples = {};
const extra = {};

function out(line = '') {
  LOG.push(line);
  console.log(line);
}
function section(title) {
  currentSection = title;
  out('');
  out(`===== ${title} =====`);
}
function clip(value, max = 320) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max})` : s;
}
function check(name, ok, detail = '') {
  const passed = !!ok;
  checks.push({ section: currentSection, name, ok: passed, detail: passed ? '' : clip(detail) });
  out(`  ${passed ? '[PASS]' : '[FAIL]'} ${name}${passed && !detail ? '' : passed ? `  :: ${clip(detail)}` : `  :: ${clip(detail)}`}`);
  return passed;
}
function info(message) {
  out(`  · ${message}`);
}
function unverifiedCheck(name, reason) {
  unverified.push({ name, reason });
  out(`  [UNVERIFIED] ${name} :: ${reason}`);
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/* ------------------------------------------------------- independent HTML parse */

function decodeEntities(input) {
  return String(input)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 单元格可见文本：去掉 <sup> 角标、剥标签、解实体、折叠空白（JS \s 含 \u00a0）。 */
function cellText(rawFragment) {
  return decodeEntities(String(rawFragment).replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** wiki 渲染器把剩余字段挤进最后一格时使用的连接标记（nbsp 实体 + 冒号）。 */
const RAW_MARKER = /(?:&#160;|&#x0*[aA]0;|&nbsp;)\s*:/;

/** 独立解析 Cvar list 区域的 <h3> 段落标题与 <tr> 数据行（不复用任何既有解析器）。 */
function parseWikiRows(html) {
  const start = html.indexOf('id="Cvar_list"');
  const end = html.indexOf('id="See_also"');
  if (start < 0 || end < 0 || end <= start) throw new Error('找不到 Cvar list 区域');
  const region = html.slice(start, end);
  const rows = [];
  const oddRows = [];
  const headerRows = [];
  let section = null;
  const tokenRe = /<h3>[\s\S]*?<\/h3>|<tr>[\s\S]*?<\/tr>/g;
  let match;
  while ((match = tokenRe.exec(region)) !== null) {
    const token = match[0];
    if (token.startsWith('<h3')) {
      const idMatch = /\bid="([^"]*)"/.exec(token);
      section = idMatch && idMatch[1] !== '' ? idMatch[1] : '_';
      continue;
    }
    if (!/<td\b/i.test(token)) {
      headerRows.push(token);
      continue;
    }
    const rawCells = [...token.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const record = {
      section,
      raw: rawCells,
      text: rawCells.map(cellText),
      marker: rawCells.some((cell) => RAW_MARKER.test(cell)),
    };
    if (rawCells.length !== 4) oddRows.push(record);
    rows.push(record);
  }
  return { region, rows, oddRows, headerRows };
}

/* --------------------------------------------------------------- misc utilities */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
function pickSample(items, count) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
const splitFlagCell = (text) => String(text ?? '')
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean);
const whitelistDedupe = (tokens) => [...new Set(tokens.filter((t) => FLAG_SET.has(t)))];
/** 把最后一格的 run-on 文本按 " : " 切成段（独立实现）。 */
const splitRunOn = (text) => String(text).split(/\s+:\s*/);

/** 我的独立筛选实现（用于与真实 filter.ts 交叉验证）。 */
function myFilterCommands(entries, state) {
  const terms = String(state.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const haystack = [
      entry.command.toLowerCase(),
      String(entry.descriptionZh ?? '').toLowerCase(),
      String(entry.descriptionEn ?? '').toLowerCase(),
    ];
    const queryOk = terms.length === 0 || terms.every((t) => haystack.some((f) => f.includes(t)));
    const flagOk = !state.flags || state.flags.length === 0 || state.flags.some((f) => entry.flags.includes(f));
    const sectionOk = !state.sections || state.sections.length === 0 || state.sections.includes(entry.section);
    return queryOk && flagOk && sectionOk;
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function waitForHttp(urlOrUrls, timeoutMs) {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.status < 500) return true;
      } catch { /* retry */ }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function findFreePort(start) {
  return new Promise((res) => {
    const tryPort = (port, attempts) => {
      const srv = net.createServer();
      srv.once('error', () => {
        if (attempts > 6) res(port + 1);
        else tryPort(port + 1, attempts + 1);
      });
      srv.listen(port, '127.0.0.1', () => {
        const actual = srv.address().port;
        srv.close(() => res(actual));
      });
    };
    tryPort(start, 0);
  });
}

function startHarnessServer(distDir, harnessPath, port, log = () => {}) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
  };
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    log(`REQ ${req.method} ${url}`);
    res.on('close', () => log(`END ${url} -> ${res.statusCode}`));
    if (url === '/harness.html' || url === '/__harness.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(readFileSync(harnessPath));
      return;
    }
    const rel = url === '/' ? 'index.html' : decodeURIComponent(url.replace(/^\/+/, ''));
    const file = resolve(distDir, rel);
    if (!file.startsWith(distDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = file.slice(file.lastIndexOf('.'));
    res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/**
 * 浏览器 harness：把构建产物作为同源 iframe 载入，真实点击搜索框 / 筛选 chip /
 * 复制按钮，并把结果回写到 <pre id="out"> 里，由 `chrome --dump-dom` 带回。
 * 剪贴板用 navigator.clipboard 的打桩捕获真实传给 writeText 的字符串。
 */
const HARNESS_HTML = [
  '<!doctype html><html><head><meta charset="utf-8"><title>cs2-verify-harness</title></head><body>',
  '<pre id="out">RUNNING</pre>',
  '<iframe id="app" src="/" width="1280" height="900"></iframe>',
  '<script>',
  'var lines=[];',
  'function emit(k,v){lines.push(k+"="+v);document.getElementById("out").textContent=lines.join("\\n");}',
  'function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
  'function hits(text){var m=/([0-9]+)\\s*\\/\\s*([0-9]+)\\s*\\u6761/.exec(text||"");if(m)return m[1];var a=/\\u5168\\u90e8\\s*([0-9]+)\\s*\\u6761/.exec(text||"");return a?a[1]:"?";}',
  'var f=document.getElementById("app");',
  'f.addEventListener("load",function(){start();});',
  'async function start(){',
  ' try{',
  '  var w=f.contentWindow,d=f.contentDocument;',
  '  for(var i=0;i<150&&!d.querySelector(".search-bar__input");i++){await sleep(200);}',
  '  var input=d.querySelector(".search-bar__input");',
  '  if(!input){emit("FATAL","no-search-input");emit("DONE","1");return;}',
  '  var setter=Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,"value").set;',
  '  function setVal(el,v){setter.call(el,v);el.dispatchEvent(new w.Event("input",{bubbles:true}));}',
  '  function countText(){var el=d.querySelector(".search-bar__count");return el?el.textContent.trim():"?";}',
  '  function rowNames(){return Array.prototype.map.call(d.querySelectorAll("[data-command]"),function(li){return li.getAttribute("data-command");});}',
  '  await sleep(900);',
  '  emit("initial_count",countText());',
  '  emit("initial_rows",String(rowNames().length));',
  '  var queries=[["sv_cheats","q_sv_cheats"],["SV_CHEATS","q_SV_CHEATS"],["\\u5b9a\\u4e49\\u670d\\u52a1","q_zh"],["mp_roundt","q_mp_roundt"]];',
  '  for(var qi=0;qi<queries.length;qi++){',
  '   setVal(input,queries[qi][0]);await sleep(700);',
  '   emit(queries[qi][1]+"_count",countText());',
  '   emit(queries[qi][1]+"_rows",rowNames().join("|"));',
  '  }',
  '  setVal(input,"");await sleep(600);',
  '  function chips(){return d.querySelectorAll(".chip");}',
  '  function chipByCode(code){var cs=chips();for(var i=0;i<cs.length;i++){var e=cs[i].querySelector(".chip__code");if(e&&e.textContent.trim()===code)return cs[i];}return null;}',
  '  var cheat=chipByCode("cheat");',
  '  emit("chip_cheat_found",String(!!cheat));',
  '  if(cheat){cheat.click();await sleep(700);emit("flag_cheat_count",countText());emit("flag_cheat_active",cheat.getAttribute("aria-pressed"));}',
  '  var sec=null,secs=d.querySelectorAll(".chip--section");',
  '  for(var si=0;si<secs.length;si++){if(secs[si].textContent.trim().charAt(0)==="M")sec=secs[si];}',
  '  emit("chip_section_M_found",String(!!sec));',
  '  if(sec){sec.click();await sleep(700);emit("flag_cheat_plus_M_count",countText());}',
  '  var clearBtn=d.querySelector(".filters__clear");',
  '  if(clearBtn){clearBtn.click();await sleep(700);}',
  '  var noneChip=null,cs2=chips();',
  '  for(var ni=0;ni<cs2.length;ni++){if(cs2[ni].textContent.trim().indexOf("\\u65e0\\u9ed8\\u8ba4\\u503c")===0)noneChip=cs2[ni];}',
  '  if(noneChip){noneChip.click();await sleep(700);emit("default_none_count",countText());emit("default_none_rows",rowNames().join("|"));}',
  '  if(clearBtn){clearBtn.click();await sleep(700);}',
  '  setVal(input,"sv_cheats");await sleep(700);',
  '  var captured=null;',
  '  try{Object.defineProperty(w.navigator,"clipboard",{configurable:true,value:{writeText:function(t){captured=t;return Promise.resolve();},readText:function(){return Promise.resolve(captured||"");}}});emit("clipboard_stub","ok");}catch(e){emit("clipboard_stub","error");}',
  '  var row=d.querySelector("[data-command=\\"sv_cheats\\"]");',
  '  emit("row_found",String(!!row));',
  '  if(row){',
  '   var btns=row.querySelectorAll(".cmd-row__buttons .btn");',
  '   btns[0].click();await sleep(500);emit("copy_line",captured===null?"(null)":JSON.stringify(captured));',
  '   btns[1].click();await sleep(500);emit("copy_name",captured===null?"(null)":JSON.stringify(captured));',
  '  }',
  '  var selAll=null,bar0=null;',
  '  if(row){var cbSel=row.querySelector(".cmd-row__check input");if(cbSel){cbSel.click();await sleep(800);}}',
  '  var allBtns=d.querySelectorAll("button");',
  '  for(var ai=0;ai<allBtns.length;ai++){if(allBtns[ai].textContent.indexOf("\\u5168\\u9009\\u5f53\\u524d\\u7ed3\\u679c")>=0)selAll=allBtns[ai];}',
  '  emit("select_all_found",String(!!selAll));',
  '  if(selAll){selAll.click();await sleep(800);}',
  '  bar0=d.querySelector(".batch-bar");',
  '  emit("batch_bar",String(!!bar0));',
  '  if(bar0){',
  '   var bb=bar0.querySelectorAll("button");',
  '   for(var bi=0;bi<bb.length;bi++){if(bb[bi].textContent.indexOf("\\u6279\\u91cf\\u590d\\u5236\\uff08\\u547d\\u4ee4+\\u503c\\uff09")>=0){bb[bi].click();break;}}',
  '   await sleep(700);emit("batch_values",captured===null?"(null)":JSON.stringify(captured));',
  '   for(var bj=0;bj<bb.length;bj++){if(bb[bj].textContent.indexOf("\\u6279\\u91cf\\u590d\\u5236\\u547d\\u4ee4\\u540d")>=0){bb[bj].click();break;}}',
  '   await sleep(700);emit("batch_names",captured===null?"(null)":JSON.stringify(captured));',
  '   for(var bk=0;bk<bb.length;bk++){if(bb[bk].textContent.indexOf("\\u6e05\\u7a7a\\u9009\\u62e9")>=0){bb[bk].click();break;}}',
  '   await sleep(500);',
  '  }',
  '  if(row){',
  '   var vi=row.querySelector(".value-field__input");',
  '   var btns2=row.querySelectorAll(".cmd-row__buttons .btn");',
  '   if(vi){setVal(vi,"0");await sleep(400);btns2[0].click();await sleep(500);emit("copy_edited",captured===null?"(null)":JSON.stringify(captured));}',
  '  }',
  ' }catch(e){emit("EXCEPTION",String(e&&e.stack?e.stack:e));}',
  ' emit("DONE","1");',
  '}',
  '</script></body></html>',
].join('\n');

/**
 * 异步跑一个子进程并收集输出。
 * 必须异步：harness 静态服务就跑在本进程里，用 spawnSync 会把事件循环冻住，
 * 浏览器发出的请求永远得不到响应（表现为 chrome 一直不退出）。
 */
function runProcess(command, args, { timeoutMs = 300000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ code: null, signal: null, stdout, stderr, error: error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

/* -------------------------------------------------- --harness-only 调试模式 */
if (ARGV.includes('--harness-only')) {
  const distDir = join(ROOT, 'dist');
  const chrome = findChrome();
  const debugRoot = join(tmpdir(), `cs2-verify-harness-debug-${process.pid}`);
  mkdirSync(debugRoot, { recursive: true });
  const harnessPath = join(debugRoot, 'harness.html');
  writeFileSync(harnessPath, HARNESS_HTML, 'utf8');
  const servedHarness = process.env.CS2_HARNESS_FILE ?? harnessPath;
  const port = await findFreePort(4455);
  const server = startHarnessServer(distDir, servedHarness, port, (m) => console.error(`    [srv] ${m}`));
  console.log(`harness: http://127.0.0.1:${port}/harness.html  chrome=${chrome}`);
  console.log(`ready=${await waitForHttp([`http://127.0.0.1:${port}/`, `http://127.0.0.1:${port}/data/commands.json`], 10000)}`);
  const profile = join(debugRoot, 'chrome-profile');
  mkdirSync(profile, { recursive: true });
  const budget = process.env.CS2_VT_BUDGET ?? '40000';
  const waitMs = Number(process.env.CS2_CHROME_TIMEOUT ?? '90000');
  const dump = await runProcess(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--no-sandbox', `--user-data-dir=${profile}`,
    ...(process.env.CS2_CHROME_FLAGS ?? '').split(' ').filter(Boolean),
    `--virtual-time-budget=${budget}`, '--dump-dom',
    process.env.CS2_DEBUG_URL ?? `http://127.0.0.1:${port}/harness.html`,
  ], { timeoutMs: waitMs });
  console.log(`chrome exit=${dump.code} signal=${dump.signal} error=${dump.error ?? '(none)'}`);
  console.log('--- stdout head ---');
  console.log((dump.stdout ?? '').slice(0, 2500));
  console.log('--- stderr tail ---');
  console.log((dump.stderr ?? '').slice(-1500));
  server.close();
  process.exit(0);
}

/* =============================================================== S0 输入与环境 */
section('S0 输入与环境');
const htmlBuf = readFileSync(HTML_PATH);
const wikiHtml = htmlBuf.toString('utf8');
const dataBuf = readFileSync(DATA_PATH);
const dataset = JSON.parse(dataBuf.toString('utf8'));
const commands = dataset.commands;
const meta = dataset.meta ?? {};
const byCommand = new Map(commands.map((c) => [c.command, c]));

info(`工作区根目录           : ${ROOT}`);
info(`node                   : ${process.version}`);
info(`data/commands.json     : ${dataBuf.length} 字节  sha256=${sha256(dataBuf)}`);
info(`data/raw/cs2_wiki.html : ${htmlBuf.length} 字节  sha256=${sha256(htmlBuf)}`);
info(`随机种子               : ${SEED}`);

const parsed = parseWikiRows(wikiHtml);
info(`HTML: Cvar list 区域 ${parsed.region.length} 字符；数据行 ${parsed.rows.length}；表头行 ${parsed.headerRows.length}`);
const markerRows = parsed.rows.filter((r) => r.marker);
info(`HTML: 带 nbsp+冒号 标记的坏行 ${markerRows.length} -> ${markerRows.map((r) => r.text[0]).join(', ')}`);
check('HTML 数据行数 === 2530（2528 条命令 + 2 条 N/A 占位行）', parsed.rows.length === 2530, String(parsed.rows.length));
check('HTML 每个数据行都是 4 个单元格', parsed.oddRows.length === 0, `${parsed.oddRows.length} 行不是 4 格`);
check('HTML 表头行（th）共 27 行且不参与命令表', parsed.headerRows.length === 27, String(parsed.headerRows.length));

/* ============================================ S1 数据集副本一致性（含分发副本） */
section('S1 数据集副本一致性（app/public 与 dist 分发副本）');
const copyBuf = existsSync(COPY_PATH) ? readFileSync(COPY_PATH) : null;
check('app/public/data/commands.json 存在', !!copyBuf);
if (copyBuf) {
  check('app/public 副本与 data/commands.json 字节完全相同', copyBuf.equals(dataBuf),
    `copy=${sha256(copyBuf)}/${copyBuf.length}B vs data=${sha256(dataBuf)}/${dataBuf.length}B`);
  let deepEqual = false;
  try {
    deepEqual = JSON.stringify(JSON.parse(copyBuf.toString('utf8'))) === JSON.stringify(dataset);
  } catch { deepEqual = false; }
  check('两个副本解析后结构完全相等', deepEqual);
}
if (existsSync(DIST_DATA_PATH)) {
  const distBuf = readFileSync(DIST_DATA_PATH);
  const distSha = sha256(distBuf);
  extra.dist = { path: 'dist/data/commands.json', sha256: distSha, bytes: distBuf.length };
  info(`dist/data/commands.json: ${distBuf.length} 字节 sha256=${distSha}`);
  check('dist/data/commands.json 与 data/commands.json 字节完全相同（不是旧英文副本）', distBuf.equals(dataBuf),
    `dist=${distSha}/${distBuf.length}B`);
  check('dist/data/commands.json sha256 === 契约值 c6ce50e8…673a1', distSha === EXPECTED_DIST_SHA, distSha);
  check('dist 副本内含 1587 条已翻译描述',
    (JSON.parse(distBuf.toString('utf8')).commands ?? []).filter((c) => c.descriptionZh).length === EXPECTED_WITH_EN);
} else {
  check('dist/data/commands.json 存在', false, DIST_DATA_PATH);
}

/* ============================================================= S2 结构不变量 */
section('S2 结构不变量：条数 / 唯一性 / id / 排序 / 字段 / 占位行');
check('commands 条数 === 2528', commands.length === EXPECTED_COMMANDS, String(commands.length));
check('meta.commands === 2528', meta.commands === EXPECTED_COMMANDS, String(meta.commands));
const names = commands.map((c) => c.command);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
check('command 唯一（无重复）', dupes.length === 0, dupes.slice(0, 10).join(', '));
check('不存在 command === "N/A" 的占位行', !commands.some((c) => c.command === 'N/A'));
check('不存在 defaultValue/descriptionEn === "N/A" 的残留占位内容',
  !commands.some((c) => c.defaultValue === 'N/A' || c.descriptionEn === 'N/A' || c.descriptionZh === 'N/A'));
check('id 为 1..2528 连续', commands.every((c, i) => c.id === i + 1),
  commands.find((c, i) => c.id !== i + 1)?.command ?? '');
check('按 command 升序（码点序）', commands.every((c, i) => i === 0 || commands[i - 1].command < c.command),
  commands.find((c, i) => i > 0 && !(commands[i - 1].command < c.command))?.command ?? '');
const badFieldRows = commands.filter((c) => JSON.stringify(Object.keys(c)) !== JSON.stringify(FIELDS));
check('每条的键顺序严格为 [id, command, defaultValue, flags, descriptionEn, descriptionZh, section]',
  badFieldRows.length === 0, badFieldRows.slice(0, 3).map((c) => c.command).join(', '));
check('section 全为 A-Z 或 "_"', commands.every((c) => /^[A-Z_]$/.test(c.section)),
  [...new Set(commands.filter((c) => !/^[A-Z_]$/.test(c.section)).map((c) => c.section))].join(','));
const nullDefaults = commands.filter((c) => c.defaultValue === null);
const cmdDefaults = commands.filter((c) => c.defaultValue === 'cmd');
info(`defaultValue: null ${nullDefaults.length} 条 (${nullDefaults.map((c) => c.command).join(', ')})；"cmd" ${cmdDefaults.length} 条`);
check('defaultValue === null 恰好 2 条（hostname, name）',
  nullDefaults.length === 2 && nullDefaults.map((c) => c.command).sort().join(',') === 'hostname,name',
  nullDefaults.map((c) => c.command).join(','));
check('meta.defaultValueNull / defaultValueCmd 与实测一致',
  meta.defaultValueNull === nullDefaults.length && meta.defaultValueCmd === cmdDefaults.length,
  `${meta.defaultValueNull}/${meta.defaultValueCmd} vs ${nullDefaults.length}/${cmdDefaults.length}`);

/* ========================================== S3 defaultValue 完整性与修复行取值 */
section('S3 defaultValue 完整性（无 "|" 误拆痕迹）与 4 个修复行精确取值');
for (const [cmd, expected] of Object.entries(EXPECTED_REPAIRS)) {
  const row = byCommand.get(cmd);
  check(`修复行 ${cmd} 的 defaultValue 精确等于契约值`, !!row && row.defaultValue === expected,
    row ? JSON.stringify(row.defaultValue) : 'missing');
}
check('没有任何 defaultValue 携带 nbsp 实体/字符残渣',
  !commands.some((c) => /&#160;|&#x0*[aA]0;|&nbsp;|\u00a0/.test(String(c.defaultValue ?? ''))),
  commands.filter((c) => /&#160;|&nbsp;|\u00a0/.test(String(c.defaultValue ?? ''))).map((c) => c.command).join(','));
check('没有任何 defaultValue 含 run-on 拼接痕迹（" : " 或被吞分隔符留下的 ":" 空隙）',
  !commands.some((c) => /\s:\s|:\s$|^\s:/.test(String(c.defaultValue ?? ''))),
  commands.filter((c) => /\s:\s|:\s$|^\s:/.test(String(c.defaultValue ?? ''))).map((c) => c.command).join(','));
const bracketDefaults = commands.filter((c) => /[[\]]/.test(String(c.defaultValue ?? '')));
info(`defaultValue 含方括号的命令：${bracketDefaults.map((c) => `${c.command}=${c.defaultValue}`).join(' | ') || '(none)'}`);
extra.bracketDefaults = bracketDefaults.map((c) => ({ command: c.command, defaultValue: c.defaultValue }));
check('唯一含方括号默认值的命令是 sv_mapvetopickvote_phase_duration（复制串只由命令名+取值拼成）',
  bracketDefaults.length === 1 && bracketDefaults[0].command === 'sv_mapvetopickvote_phase_duration',
  bracketDefaults.map((c) => c.command).join(','));

/* ============================================================ S4 flags 白名单 */
section('S4 flags 白名单与来源保真');
const allFlagTokens = commands.flatMap((c) => c.flags);
const outside = [...new Set(allFlagTokens.filter((f) => !FLAG_SET.has(f)))];
check('所有 flag 都落在 21 条白名单内', outside.length === 0, outside.join(', '));
check('每条内部 flag 无重复', commands.every((c) => new Set(c.flags).size === c.flags.length),
  commands.filter((c) => new Set(c.flags).size !== c.flags.length).map((c) => c.command).join(','));
check('meta.flags 与白名单一致', JSON.stringify(meta.flags) === JSON.stringify(FLAG_WHITELIST));
const freq = {};
for (const f of allFlagTokens) freq[f] = (freq[f] ?? 0) + 1;
extra.flagFrequency = freq;
const metaFreq = meta.flagFrequency ?? {};
const freqMismatch = Object.entries(freq).filter(([k, v]) => metaFreq[k] !== v);
check('meta.flagFrequency 与实测一致（键集合与计数）',
  freqMismatch.length === 0 && Object.keys(freq).length === Object.keys(metaFreq).length,
  freqMismatch.map(([k, v]) => `${k}:${metaFreq[k]}!=${v}`).join(', '));
check('meta.unknownFlagTokens / unhandledRunOnRows 均为空数组',
  Array.isArray(meta.unknownFlagTokens) && meta.unknownFlagTokens.length === 0 &&
  Array.isArray(meta.unhandledRunOnRows) && meta.unhandledRunOnRows.length === 0);

/* ==================================================== S5 翻译覆盖与 meta 复算 */
section('S5 翻译覆盖：复算 meta 两个数字 + 覆盖率');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const withEn = commands.filter((c) => c.descriptionEn !== '');
const uniqueEn = new Set(withEn.map((c) => c.descriptionEn));
info(`有英文描述的命令 ${withEn.length}；唯一英文描述 ${uniqueEn.size}；无英文描述 ${commands.length - withEn.length}`);
check('有英文描述的命令数 === 1587（独立复算，不读 meta）', withEn.length === EXPECTED_WITH_EN, String(withEn.length));
check('唯一英文描述数 === 1465（独立复算，不读 meta）', uniqueEn.size === EXPECTED_UNIQUE_EN, String(uniqueEn.size));
check('meta.withEnglishDescription 未说谎', meta.withEnglishDescription === withEn.length, String(meta.withEnglishDescription));
check('meta.uniqueEnglishDescriptions 未说谎', meta.uniqueEnglishDescriptions === uniqueEn.size, String(meta.uniqueEnglishDescriptions));
check('meta.emptyEnglishDescriptions === 2528 - 1587 = 941',
  meta.emptyEnglishDescriptions === 941 && commands.length - withEn.length === 941);
const missingZh = withEn.filter((c) => String(c.descriptionZh ?? '').trim() === '');
const noCjk = withEn.filter((c) => !CJK.test(String(c.descriptionZh ?? '')));
check('有英文描述的命令 100% 有非空中文（空译文数 === 0）', missingZh.length === 0,
  `${missingZh.length} 条：${missingZh.slice(0, 8).map((c) => c.command).join(', ')}`);
check('有英文描述的命令 100% 含 CJK 字符（含 CJK 比例 = 100%）', noCjk.length === 0,
  `${noCjk.length} 条：${noCjk.slice(0, 8).map((c) => c.command).join(', ')}`);
const cjkRatio = withEn.length === 0 ? 0 : (withEn.length - noCjk.length) / withEn.length;
extra.translationCoverage = {
  withEnglish: withEn.length, uniqueEnglish: uniqueEn.size, emptyTranslations: missingZh.length,
  cjkRatio, noCjk: noCjk.map((c) => c.command),
  identicalToEnglish: withEn.filter((c) => c.descriptionZh === c.descriptionEn).map((c) => c.command),
};
info(`空译文 0 条；含 CJK 比例 ${(cjkRatio * 100).toFixed(2)}%`);
const orphanZh = commands.filter((c) => c.descriptionEn === '' && String(c.descriptionZh ?? '') !== '');
check('无英文描述的命令（941 条）descriptionZh 保持空', orphanZh.length === 0, `${orphanZh.length} 条`);
const uniqueZh = new Set(withEn.map((c) => c.descriptionZh));
info(`唯一中文译文 ${uniqueZh.size} 条`);
check('meta.translationStatus 数字与实测一致',
  meta.translationStatus?.descriptionZhFilled === withEn.length &&
  meta.translationStatus?.uniqueTranslations === uniqueZh.size &&
  meta.translationStatus?.emptyTranslations === 0,
  JSON.stringify(meta.translationStatus));
const byEn = new Map();
for (const c of withEn) {
  if (!byEn.has(c.descriptionEn)) byEn.set(c.descriptionEn, new Set());
  byEn.get(c.descriptionEn).add(c.descriptionZh);
}
const inconsistent = [...byEn.entries()].filter(([, set]) => set.size > 1);
check('同一英文描述的所有命令拿到完全相同的译文（merge 未错位）', inconsistent.length === 0,
  inconsistent.slice(0, 3).map(([en, set]) => `${clip(en, 40)} -> ${set.size} 种`).join(' | '));

/* ============================================ S6 与源站 HTML 全量逐行比对 */
section('S6 与源站 HTML 全量比对（2530 行 + 随机 40 条样本）');
const placeholderRows = parsed.rows.filter((r) => r.text[0] === 'N/A');
const dataRows = parsed.rows.filter((r) => r.text[0] !== 'N/A');
check('HTML 里 "N/A" 占位行恰好 2 条且未进入 dataset',
  placeholderRows.length === 2 && !commands.some((c) => c.command === 'N/A'));
check('HTML 数据行 - 占位行 === 2528', dataRows.length === EXPECTED_COMMANDS, String(dataRows.length));
const htmlNames = dataRows.map((r) => r.text[0]);
const htmlDupes = htmlNames.filter((n, i) => htmlNames.indexOf(n) !== i);
check('HTML 中 command 无重复', htmlDupes.length === 0, htmlDupes.slice(0, 5).join(', '));

const fieldMismatches = [];
const htmlSeen = new Set();
for (const row of dataRows) {
  const command = row.text[0];
  htmlSeen.add(command);
  const record = byCommand.get(command);
  if (!record) {
    fieldMismatches.push({ command, field: 'exists', html: '(row present)', data: '(missing)' });
    continue;
  }
  let expectedDefault = row.text[1] === '' ? null : row.text[1];
  let expectedFlags = whitelistDedupe(splitFlagCell(row.text[2]));
  let expectedDesc = row.text[3];
  if (row.marker) {
    expectedDefault = EXPECTED_REPAIRS[command];
    const segments = splitRunOn(row.text[3]);
    expectedFlags = whitelistDedupe(splitFlagCell(segments[segments.length - 2] ?? ''));
    expectedDesc = segments[segments.length - 1];
  }
  if (record.section !== row.section) fieldMismatches.push({ command, field: 'section', html: row.section, data: record.section });
  if (record.defaultValue !== expectedDefault) fieldMismatches.push({ command, field: 'defaultValue', html: expectedDefault, data: record.defaultValue });
  if (record.flags.join(',') !== expectedFlags.join(',')) fieldMismatches.push({ command, field: 'flags', html: expectedFlags.join(','), data: record.flags.join(',') });
  if (record.descriptionEn !== expectedDesc) fieldMismatches.push({ command, field: 'descriptionEn', html: expectedDesc, data: record.descriptionEn });
}
const missingRows = commands.filter((c) => !htmlSeen.has(c.command)).map((c) => c.command);
check('HTML 每一行都能对上 dataset 且 command/defaultValue/flags/descriptionEn/section 全一致',
  fieldMismatches.length === 0,
  `${fieldMismatches.length} 处不一致：` + fieldMismatches.slice(0, 6).map((m) => `${m.command}.${m.field}`).join(', '));
check('dataset 里没有 HTML 中不存在的命令', missingRows.length === 0, missingRows.slice(0, 8).join(', '));
extra.fieldMismatches = fieldMismatches.slice(0, 50);

const htmlSample = pickSample(dataRows, 40).map((row) => {
  const record = byCommand.get(row.text[0]);
  return {
    command: row.text[0],
    section: row.section,
    html: { defaultValue: row.text[1] === '' ? null : row.text[1], flags: splitFlagCell(row.text[2]), descriptionEn: row.text[3], marker: row.marker },
    data: record ? { defaultValue: record.defaultValue, flags: record.flags, descriptionEn: record.descriptionEn, section: record.section } : null,
    ok: !!record,
  };
});
samples.htmlRows = htmlSample;
out(`  --- 随机抽样 40 条（seed=${SEED}，可复现）---`);
for (const s of htmlSample) {
  out(`    ${s.command}  [${s.section}] default=${JSON.stringify(s.html.defaultValue)} flags=[${s.html.flags}] desc=${clip(s.html.descriptionEn, 70)}`);
}
check('随机 40 条 HTML 抽样全部命中', htmlSample.every((s) => s.ok));

/* ================================================ S7 翻译质量抽样（人工判读） */
section('S7 翻译质量抽样（随机 40 条 英→中 对照，供人工判读）');
const translationSample = pickSample(withEn, 40).map((c) => ({
  command: c.command, descriptionEn: c.descriptionEn, descriptionZh: c.descriptionZh,
}));
samples.translations = translationSample;
for (const s of translationSample) {
  out(`    ■ ${s.command}`);
  out(`      EN: ${clip(s.descriptionEn, 420)}`);
  out(`      ZH: ${clip(s.descriptionZh, 420)}`);
}
check('随机 40 条译文均非空且含 CJK（格式底线；语义判读见任务报告）',
  translationSample.every((s) => s.descriptionZh.trim() !== '' && CJK.test(s.descriptionZh)));

// 全库风险扫描：长度比异常短/长最可能藏着漏译或凭空添加
const lengthScored = withEn.map((c) => ({
  command: c.command,
  ratio: c.descriptionZh.length / Math.max(1, c.descriptionEn.length),
  descriptionEn: c.descriptionEn,
  descriptionZh: c.descriptionZh,
}));
const byRatio = [...lengthScored].sort((a, b) => a.ratio - b.ratio);
const minRatio = byRatio[0]?.ratio ?? 0;
extra.translationRiskScan = {
  minRatio,
  maxRatio: byRatio[byRatio.length - 1]?.ratio ?? 0,
  shortest: byRatio.slice(0, 10),
  longest: byRatio.slice(-10).reverse(),
  identical: lengthScored.filter((s) => s.descriptionZh === s.descriptionEn).map((s) => s.command),
  enEndsWithPeriodZhWithout: withEn.filter((c) => /\.$/.test(c.descriptionEn) && !/[。！？；：）”"）]$|\.$/.test(c.descriptionZh)).length,
};
info(`译文/原文长度比：最小 ${minRatio.toFixed(3)}，最大 ${(byRatio[byRatio.length - 1]?.ratio ?? 0).toFixed(3)}`);
out('  --- 最短 10 条（最可能漏译）---');
for (const s of byRatio.slice(0, 10)) {
  out(`    ${s.ratio.toFixed(2)} ${s.command}`);
  out(`       EN: ${clip(s.descriptionEn, 150)}`);
  out(`       ZH: ${clip(s.descriptionZh, 150)}`);
}
out('  --- 最长 10 条（最可能添加内容）---');
for (const s of byRatio.slice(-10).reverse()) {
  out(`    ${s.ratio.toFixed(2)} ${s.command}`);
  out(`       EN: ${clip(s.descriptionEn, 150)}`);
  out(`       ZH: ${clip(s.descriptionZh, 150)}`);
}
check('没有译文与英文原文完全相同的条目（不是漏翻）',
  extra.translationRiskScan.identical.length === 0, extra.translationRiskScan.identical.slice(0, 5).join(','));
check('最短译文的长度比 >= 0.12（无整句漏译痕迹）', minRatio >= 0.12, `minRatio=${minRatio.toFixed(3)} (${byRatio[0]?.command})`);
// 译文明显长于原文的条目：都是「原文本身只是一个标识符/取值」的退化描述，
// translator 按 captain 裁决补了中文释义（否则该条会因不含 CJK 而不合格）。
const additive = byRatio.filter((s) => s.ratio > 1.4);
info(`译文长度比 > 1.4（原文退化为标识符/取值、译文补中文释义）的条目 ${additive.length} 条：${additive.map((s) => s.command).join(', ')}`);
extra.translationRiskScan.additive = additive.map((s) => ({ command: s.command, ratio: Number(s.ratio.toFixed(2)), descriptionEn: s.descriptionEn, descriptionZh: s.descriptionZh }));

/* ================================================= S8 前端：构建 + 服务 + 浏览器 */
section('S8 前端：真实 pnpm build + 真实服务 + 真实浏览器 DOM 交互');
let previewChild = null;
let harnessServer = null;
let tmpHarnessRoot = null;
try {
  if (SKIP_FRONTEND) {
    unverifiedCheck('前端 build / 服务 / 浏览器验证', 'CS2_SKIP_FRONTEND=1，本次运行跳过');
  } else {
    const build = spawnSync('pnpm', ['build'], {
      cwd: ROOT, encoding: 'utf8', shell: true, timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    });
    const buildAll = `${build.stdout ?? ''}\n${build.stderr ?? ''}`.trim();
    const buildTail = buildAll.split('\n').slice(-12).join('\n');
    extra.build = { exitCode: build.status, output: buildTail };
    out('  --- pnpm build 输出（末 12 行）---');
    for (const line of buildTail.split('\n')) out(`    ${line}`);
    check('pnpm build 退出码 === 0', build.status === 0, `exit=${build.status}`);
    check('build 日志显示数据集已被复制到 dist（不是旧副本）', /已复制数据集/.test(buildAll));
    if (existsSync(DIST_DATA_PATH)) {
      const distAfter = readFileSync(DIST_DATA_PATH);
      check('build 之后 dist/data/commands.json 仍与 data/commands.json 字节完全相同', distAfter.equals(dataBuf),
        `${sha256(distAfter)}/${distAfter.length}B`);
    } else {
      check('build 之后 dist/data/commands.json 存在', false);
    }

    const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const portA = await findFreePort(4391);
    // 显式 --host 127.0.0.1：Windows 上 node 把 localhost 解析到 ::1，默认绑定会让 127.0.0.1 探测失败
    previewChild = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(portA), '--strictPort'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let previewLog = '';
    previewChild.stdout.on('data', (d) => { previewLog += d.toString(); });
    previewChild.stderr.on('data', (d) => { previewLog += d.toString(); });
    const baseA = `http://127.0.0.1:${portA}`;
    const readyA = await waitForHttp([`${baseA}/`, `http://localhost:${portA}/`], 30000);
    check('vite preview 服务可访问（真实产物）', readyA, previewLog.slice(-300));
    if (readyA) {
      const res = await fetch(`${baseA}/data/commands.json`);
      const buf = Buffer.from(await res.arrayBuffer());
      check('preview GET /data/commands.json 返回 200 + JSON',
        res.status === 200 && /json/.test(res.headers.get('content-type') ?? ''),
        `${res.status} ${res.headers.get('content-type')}`);
      check('preview 提供的数据集与本地 data/commands.json 字节完全相同（含 1587 条中文）',
        sha256(buf) === sha256(dataBuf), `http=${sha256(buf)}/${buf.length}B`);
      check('preview 数据集里中文描述条数 === 1587',
        JSON.parse(buf.toString('utf8')).commands.filter((c) => c.descriptionZh).length === EXPECTED_WITH_EN);
      const indexHtml = await (await fetch(`${baseA}/`)).text();
      check('preview index.html 引用了打包产物', /\/assets\/index-.*\.js/.test(indexHtml));
      const jsPath = /src="([^"]*\/assets\/[^"]*\.js)"/.exec(indexHtml)?.[1];
      const jsBuf = jsPath ? Buffer.from(await (await fetch(baseA + jsPath)).arrayBuffer()) : null;
      extra.bundle = jsPath && jsBuf ? { jsPath, bytes: jsBuf.length, sha256: sha256(jsBuf) } : null;
      info(`打包 JS: ${jsPath} ${jsBuf ? `${jsBuf.length} 字节 sha256=${sha256(jsBuf)}` : '(未取到)'}`);

      const chrome = findChrome();
      if (!chrome) {
        unverifiedCheck('浏览器内搜索/筛选/一键复制行为', '未找到 Chrome/Edge 可执行文件');
      } else if (!jsBuf || !jsPath) {
        unverifiedCheck('浏览器内搜索/筛选/一键复制行为', '未取到打包 JS 资源');
      } else {
        const distDir = join(ROOT, 'dist');
        tmpHarnessRoot = join(tmpdir(), `cs2-verify-harness-${process.pid}-${Date.now()}`);
        mkdirSync(tmpHarnessRoot, { recursive: true });
        const harnessPath = join(tmpHarnessRoot, 'harness.html');
        writeFileSync(harnessPath, HARNESS_HTML, 'utf8');
        const portB = await findFreePort(portA + 1);
        harnessServer = startHarnessServer(distDir, harnessPath, portB);
        await waitForHttp(`http://127.0.0.1:${portB}/`, 15000);
        const harnessJs = Buffer.from(await (await fetch(`http://127.0.0.1:${portB}${jsPath}`)).arrayBuffer());
        check('harness 服务提供的 JS 与 preview 服务同字节（同源驱动不影响保真度）',
          sha256(harnessJs) === sha256(jsBuf));
        const profile = join(tmpHarnessRoot, 'chrome-profile');
        mkdirSync(profile, { recursive: true });
        const dump = await runProcess(chrome, [
          '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
          '--disable-extensions', '--mute-audio', '--no-sandbox', `--user-data-dir=${profile}`,
          '--virtual-time-budget=40000', '--dump-dom', `http://127.0.0.1:${portB}/harness.html`,
        ], { timeoutMs: 300000 });
        const dom = dump.stdout ?? '';
        const preMatch = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
        const harnessOut = preMatch ? decodeEntities(preMatch[1]) : '';
        const kv = new Map();
        for (const line of harnessOut.split('\n')) {
          const i = line.indexOf('=');
          // dump-dom 的序列化是 CRLF，值末尾会带 \r，必须剥掉再做等值比较
          if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).replace(/\r/g, ''));
        }
        extra.harness = Object.fromEntries(kv);
        /** 剪贴板内容在 harness 侧用 JSON.stringify 回传，避免多行文本被按行折断。 */
        const kvStr = (key) => {
          const raw = kv.get(key);
          if (raw === undefined || raw === '(null)') return null;
          try { return JSON.parse(raw); } catch { return raw; }
        };
        out('  --- 浏览器 harness 回传（真实 DOM 驱动 + clipboard 打桩）---');
        for (const line of harnessOut.split('\n')) out(`    ${line}`);
        if (!preMatch || kv.size === 0) {
          check('浏览器 harness 产出可解析结果', false,
            `chrome exit=${dump.code} signal=${dump.signal} stderr=${clip((dump.stderr ?? '').slice(-300), 300)}`);
        } else {
          const filterMod = await import(pathToFileURL(join(ROOT, 'app', 'src', 'lib', 'filter.ts')).href);
          const copyMod = await import(pathToFileURL(join(ROOT, 'app', 'src', 'lib', 'copy.ts')).href);
          const payload = JSON.parse(readFileSync(COPY_PATH, 'utf8')).commands;
          const domHits = (text) => {
            const m = /(\d+)\s*\/\s*(\d+)\s*条/.exec(text ?? '');
            if (m) return Number(m[1]);
            const a = /全部\s*(\d+)\s*条/.exec(text ?? '');
            return a ? Number(a[1]) : null;
          };
          check('初始文案为「全部 2528 条」', /全部\s*2528\s*条/.test(kv.get('initial_count') ?? ''), kv.get('initial_count'));
          const initialRows = Number(kv.get('initial_rows'));
          check('首屏按 80 条分块渲染（不是一次性 2528 行）', initialRows >= 80 && initialRows < EXPECTED_COMMANDS, String(initialRows));

          for (const c of [
            { q: 'sv_cheats', key: 'q_sv_cheats' },
            { q: 'SV_CHEATS', key: 'q_SV_CHEATS' },
            { q: '定义服务', key: 'q_zh' },
            { q: 'mp_roundt', key: 'q_mp_roundt' },
          ]) {
            const expectedReal = filterMod.filterCommands(payload, { ...filterMod.EMPTY_FILTERS, query: c.q }).length;
            const expectedMine = myFilterCommands(payload, { query: c.q }).length;
            check(`[交叉] 真实 filter.ts 与我的独立实现一致：query="${c.q}"`, expectedReal === expectedMine,
              `${expectedReal} vs ${expectedMine}`);
            check(`浏览器搜索 "${c.q}" 命中数 === ${Math.max(expectedReal, expectedMine)}`,
              domHits(kv.get(`${c.key}_count`)) === expectedReal, `${kv.get(`${c.key}_count`)} -> ${domHits(kv.get(`${c.key}_count`))}`);
            const rows = (kv.get(`${c.key}_rows`) ?? '').split('|').filter(Boolean);
            check(`浏览器搜索结果每一行都真的含关键词 "${c.q}"`,
              rows.length > 0 && rows.every((r) => {
                const e = byCommand.get(r);
                return `${r} ${e?.descriptionZh ?? ''} ${e?.descriptionEn ?? ''}`.toLowerCase().includes(c.q.toLowerCase());
              }), rows.slice(0, 8).join(','));
          }
          const cheatExpected = payload.filter((c) => c.flags.includes('cheat')).length;
          check(`浏览器点击「作弊」标记筛选命中 ${cheatExpected} 条`,
            domHits(kv.get('flag_cheat_count')) === cheatExpected, kv.get('flag_cheat_count'));
          check('「作弊」chip 处于选中态（aria-pressed=true）', kv.get('flag_cheat_active') === 'true', kv.get('flag_cheat_active'));
          const mExpected = payload.filter((c) => c.section === 'M').length;
          check(`浏览器再点「首字母 M」= 跨维度 AND，命中 ${payload.filter((c) => c.flags.includes('cheat') && c.section === 'M').length} 条`,
            domHits(kv.get('flag_cheat_plus_M_count')) === payload.filter((c) => c.flags.includes('cheat') && c.section === 'M').length,
            `${kv.get('flag_cheat_plus_M_count')} (M 单维=${mExpected})`);
          check('「无默认值」筛选命中 2 条且为 hostname/name',
            domHits(kv.get('default_none_count')) === 2 &&
            (kv.get('default_none_rows') ?? '').split('|').sort().join(',') === 'hostname,name',
            `${kv.get('default_none_count')} :: ${kv.get('default_none_rows')}`);

          const svCheats = byCommand.get('sv_cheats');
          const expectLine = copyMod.buildCommandLine('sv_cheats', svCheats.defaultValue);
          const copied = {
            line: kvStr('copy_line'), name: kvStr('copy_name'), edited: kvStr('copy_edited'),
            batchValues: kvStr('batch_values'), batchNames: kvStr('batch_names'),
          };
          check(`浏览器点「复制命令+值」写出的字符串 === ${JSON.stringify(expectLine)}`,
            copied.line === expectLine, `got=${JSON.stringify(copied.line)}`);
          check('浏览器点「仅命令」写出的字符串 === "sv_cheats"',
            copied.name === 'sv_cheats', JSON.stringify(copied.name));
          const hits = filterMod.filterCommands(payload, { ...filterMod.EMPTY_FILTERS, query: 'sv_cheats' });
          const expectBatchValues = copyMod.buildBatchText(
            hits.map((c) => ({ command: c.command, defaultValue: c.defaultValue })), { includeValues: true });
          const expectBatchNames = copyMod.buildBatchText(
            hits.map((c) => ({ command: c.command, defaultValue: c.defaultValue })), { includeValues: false });
          check(`浏览器勾选后「全选当前结果」再批量复制（命令+值）=== ${hits.length} 行真实拼装`,
            copied.batchValues === expectBatchValues, `got=${JSON.stringify(clip(copied.batchValues, 200))}`);
          check('浏览器批量复制命令名 === 结果集的命令名 LF 拼接',
            copied.batchNames === expectBatchNames, `got=${JSON.stringify(clip(copied.batchNames, 200))}`);
          check('浏览器把行内「值」改成 0 后复制 === "sv_cheats 0"',
            copied.edited === 'sv_cheats 0', JSON.stringify(copied.edited));
          check('复制串全程不含任何被翻译的方括号占位符（剪贴板里不会出现中文占位符）',
            Object.values(copied).every((t) => !/\[[^\]]*[\u4e00-\u9fff][^\]]*\]/.test(t ?? '')),
            JSON.stringify([copied.line, copied.batchValues]));
          extra.copyStrings = copied;
          out(`  实际剪贴板内容：copy_line=${JSON.stringify(copied.line)}；batch_values=${JSON.stringify(copied.batchValues)}`);
        }
      }
    }
  }
} catch (error) {
  check('S8 前端验证过程未抛异常', false,
    error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error));
  unverifiedCheck('前端部分子项', 'S8 过程中出现异常，详见上方 FAIL');
} finally {
  if (harnessServer) { try { harnessServer.close(); } catch { /* ignore */ } }
  if (previewChild) { try { previewChild.kill(); } catch { /* ignore */ } }
  if (tmpHarnessRoot && tmpHarnessRoot.startsWith(tmpdir()) && tmpHarnessRoot.includes('cs2-verify-harness')) {
    try { rmSync(tmpHarnessRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/* ===================================================== S9 坏行专项（独立枚举） */
section('S9 坏行专项：HTML 独立枚举 vs meta.repairedRows');
const htmlCorruptNames = markerRows.map((r) => r.text[0]).sort();
const metaRepairNames = (meta.repairedRows ?? []).map((r) => r.command).sort();
out(`  HTML 判据（原始单元格含 &#160;/&nbsp; 且紧邻 ":"）命中 ${htmlCorruptNames.length} 行：${htmlCorruptNames.join(', ')}`);
out(`  meta.repairedRows（${metaRepairNames.length} 行）：${metaRepairNames.join(', ')}`);
check('HTML 独立枚举的坏行 === meta.repairedRows（数量与集合都一致）',
  JSON.stringify(htmlCorruptNames) === JSON.stringify(metaRepairNames),
  `html=[${htmlCorruptNames}] meta=[${metaRepairNames}]`);
for (const name of ['changelevel', 'map']) {
  const row = dataRows.find((r) => r.text[0] === name);
  check(`假阳性排除：${name} 描述里有 " : " 但原始单元格没有 nbsp 实体标记`, !!row && / :/.test(row.text[3]) && !row.marker,
    row ? `desc=${clip(row.text[3], 90)} marker=${row.marker}` : 'row missing');
}
const repairDetail = [];
for (const repaired of meta.repairedRows ?? []) {
  const row = markerRows.find((r) => r.text[0] === repaired.command);
  const record = byCommand.get(repaired.command);
  const segments = row ? splitRunOn(row.text[3]) : [];
  const derivedFlags = whitelistDedupe(splitFlagCell(segments[segments.length - 2] ?? ''));
  const derivedDesc = segments[segments.length - 1] ?? '';
  const joined = row ? `${row.text[1]}${row.text[2]}`.replace(/\s+/g, '') : '';
  const descHead = row ? splitRunOn(row.text[3])[0].replace(/\s+/g, '') : '';
  const skeleton = `${joined}${descHead}`.replace(/[|:]/g, '');
  const restored = String(record?.defaultValue ?? '');
  const restoredSkeleton = restored.replace(/\s+/g, '').replace(/[|:]/g, '');
  const cellExactly = row ? [row.text[1], row.text[2], row.text[3]].includes(restored) : false;
  const structurallyConsistent = cellExactly || skeleton === restoredSkeleton;
  const detail = {
    command: repaired.command,
    sectionMatches: row?.section === repaired.section,
    wikiCellsMatch: !!row && repaired.wikiCells?.defaultValue === row.text[1] &&
      repaired.wikiCells?.flags === row.text[2] && repaired.wikiCells?.description === row.text[3],
    derivedFlags: derivedFlags.join(','),
    derivedDesc,
    flagsMatch: derivedFlags.join(',') === (repaired.restored?.flags ?? []).join(','),
    descMatch: derivedDesc === (repaired.restored?.descriptionEn ?? ''),
    restoredValueMatchesDataset: restored === EXPECTED_REPAIRS[repaired.command] && restored === repaired.restored?.defaultValue,
    structurallyConsistent,
    cellExactly,
    structure: { skeleton: clip(skeleton, 60), restoredSkeleton: clip(restoredSkeleton, 60) },
  };
  repairDetail.push(detail);
  out(`  · ${repaired.command}: 还原 default=${JSON.stringify(restored)} flags=[${derivedFlags}] desc=${clip(derivedDesc, 40)}`);
  out(`      wikiCells=HTML原始单元格? ${detail.wikiCellsMatch}；通用重算 flags/desc 与枚举一致? ${detail.flagsMatch && detail.descMatch}；结构自洽? ${structurallyConsistent} (${cellExactly ? '直接命中单元格' : '骨架等同'})`);
}
extra.repairedRows = repairDetail;
check('4 个坏行的 wikiCells（原始损坏单元格）与 HTML 逐字一致', repairDetail.every((d) => d.wikiCellsMatch));
check('4 个坏行的还原 flags/description 可由 run-on 分段通用重算', repairDetail.every((d) => d.flagsMatch && d.descMatch));
check('4 个坏行的还原式结构自洽（默认值可由被拆散的单元格 + 被吞分隔符重建）', repairDetail.every((d) => d.structurallyConsistent));
check('4 个坏行的 dataset 取值 === meta.restored === 契约值', repairDetail.every((d) => d.restoredValueMatchesDataset));
check('4 个坏行的 section 与 HTML 段落一致', repairDetail.every((d) => d.sectionMatches));
check('全库再无其它单元格携带 nbsp 实体标记',
  parsed.rows.every((r) => !r.marker || EXPECTED_REPAIRS[r.text[0]] !== undefined),
  parsed.rows.filter((r) => r.marker && EXPECTED_REPAIRS[r.text[0]] === undefined).map((r) => r.text[0]).join(','));
check('全库任何字段都不含 nbsp 残渣（descriptionEn/descriptionZh/defaultValue）',
  commands.every((c) => !/&#160;|&nbsp;|\u00a0/.test(`${c.descriptionEn}\u0000${c.descriptionZh}\u0000${c.defaultValue ?? ''}`)));

/* =========================================================== S10 邻行污染 */
section('S10 邻行污染：4 个坏行 × 前后邻行（8 个邻居）逐字段比对');
const neighborReport = [];
for (const row of markerRows) {
  const idx = parsed.rows.indexOf(row);
  for (const [side, neighbour] of [['prev', parsed.rows[idx - 1]], ['next', parsed.rows[idx + 1]]]) {
    if (!neighbour) {
      neighborReport.push({ subject: row.text[0], side, neighbour: null, status: 'NONE' });
      continue;
    }
    const name = neighbour.text[0];
    const record = byCommand.get(name);
    const isPlaceholder = name === 'N/A';
    const neighbourCorrupt = neighbour.marker;
    const segs = splitRunOn(neighbour.text[3]);
    const expected = neighbourCorrupt
      ? { defaultValue: EXPECTED_REPAIRS[name], flags: whitelistDedupe(splitFlagCell(segs[segs.length - 2] ?? '')), descriptionEn: segs[segs.length - 1] }
      : {
        defaultValue: neighbour.text[1] === '' ? null : neighbour.text[1],
        flags: whitelistDedupe(splitFlagCell(neighbour.text[2])),
        descriptionEn: neighbour.text[3],
      };
    const problems = [];
    if (isPlaceholder) {
      // 占位行，被有意丢弃
    } else if (!record) {
      problems.push('命令在 dataset 中缺失');
    } else {
      if (record.defaultValue !== expected.defaultValue) problems.push(`defaultValue ${JSON.stringify(record.defaultValue)} != html ${JSON.stringify(expected.defaultValue)}`);
      if (record.flags.join(',') !== expected.flags.join(',')) problems.push(`flags [${record.flags}] != html [${expected.flags}]`);
      if (record.descriptionEn !== expected.descriptionEn) problems.push(`descriptionEn ${JSON.stringify(record.descriptionEn)} != html ${JSON.stringify(expected.descriptionEn)}`);
      if (record.section !== neighbour.section) problems.push(`section ${record.section} != html ${neighbour.section}`);
    }
    const entry = {
      subject: row.text[0], side, neighbour: name, corrupt: neighbourCorrupt,
      status: problems.length ? 'MISMATCH' : isPlaceholder ? 'PLACEHOLDER' : neighbourCorrupt ? 'OK(repaired neighbour)' : 'OK',
      problems,
    };
    neighborReport.push(entry);
    out(`  ${row.text[0]} ${side === 'prev' ? '←' : '→'} ${name}  [${entry.status}]${problems.length ? ` :: ${problems.join('; ')}` : ''}`);
  }
}
extra.neighbours = neighborReport;
check('8 个邻行全部取回并逐字段一致（修复没有连带破坏邻行）',
  neighborReport.length === 8 && neighborReport.every((n) => n.status.startsWith('OK')),
  neighborReport.filter((n) => !n.status.startsWith('OK')).map((n) => `${n.subject}/${n.side}:${n.problems.join(';')}`).join(' | '));
check('tv_broadcast_url 与 tv_broadcast_url1 互为邻居且双双被识别为坏行',
  neighborReport.some((n) => n.subject === 'tv_broadcast_url' && n.neighbour === 'tv_broadcast_url1' && n.corrupt) &&
  neighborReport.some((n) => n.subject === 'tv_broadcast_url1' && n.neighbour === 'tv_broadcast_url' && n.corrupt));

/* ======================================================= S11 静默失效防护 */
section('S11 静默失效防护：防御断言 + 隔离负向测试');
const prepareSrc = readFileSync(join(ROOT, 'tools', 'prepare-data.mjs'), 'utf8');
const verifySrc = readFileSync(join(ROOT, 'tools', 'verify-dataset.mjs'), 'utf8');
const prepareGuardLines = prepareSrc.split('\n')
  .map((l, i) => ({ n: i + 1, l }))
  .filter(({ l }) => /isRunOnRow|unhandledRunOnRows|is enumerated in WIKI_ROW_REPAIRS|every corrupt run-on row has an enumerated repair|number of repaired rows ===|misaligned|bare engine-flag/.test(l))
  .map(({ n, l }) => `${n}: ${l.trim()}`);
const verifyGuardLines = verifySrc.split('\n')
  .map((l, i) => ({ n: i + 1, l }))
  .filter(({ l }) => /WIKI_NBSP_COLON|criterionB|corruptNames|corrupt-row set === meta\.repairedRows|two independent corruption criteria agree|no residue/.test(l))
  .map(({ n, l }) => `${n}: ${l.trim()}`);
extra.guards = { prepare: prepareGuardLines, verify: verifyGuardLines };
out('  prepare-data.mjs 的防御断言（运行在 raw JSON 层）：');
for (const l of prepareGuardLines.slice(0, 8)) out(`    ${clip(l, 190)}`);
out('  verify-dataset.mjs 的防御断言（运行在原始 HTML 层）：');
for (const l of verifyGuardLines.slice(0, 10)) out(`    ${clip(l, 190)}`);
check('prepare-data.mjs 有「未登记的 run-on 行 ⇒ 断言失败」逻辑链',
  /isRunOnRow/.test(prepareSrc) && /unhandledRunOnRows\.length === 0/.test(prepareSrc) && /WIKI_ROW_REPAIRS\[command\]/.test(prepareSrc));
check('verify-dataset.mjs 有「HTML 坏行集合 === meta.repairedRows」的 HTML 级断言',
  /WIKI_NBSP_COLON/.test(verifySrc) && /corrupt-row set === meta\.repairedRows set/.test(verifySrc) && /criterionB/.test(verifySrc));
check('prepare-data.mjs 含有与判据 A/B 正交的「错位防护」判据（t10 封死 t7 报告盲区的那一条）',
  /misaligned/i.test(prepareSrc) && /bare engine-flag/i.test(prepareSrc));

const negativeTests = [];
function isolatedCopy(tag) {
  const dir = join(tmpdir(), `cs2-verify-${tag}-${process.pid}-${Date.now()}`);
  mkdirSync(join(dir, 'tools'), { recursive: true });
  mkdirSync(join(dir, 'data', 'raw'), { recursive: true });
  copyFileSync(join(ROOT, 'tools', 'prepare-data.mjs'), join(dir, 'tools', 'prepare-data.mjs'));
  copyFileSync(join(ROOT, 'tools', 'verify-dataset.mjs'), join(dir, 'tools', 'verify-dataset.mjs'));
  copyFileSync(join(ROOT, 'data', 'cs2-commands.raw.json'), join(dir, 'data', 'cs2-commands.raw.json'));
  copyFileSync(HTML_PATH, join(dir, 'data', 'raw', 'cs2_wiki.html'));
  cpSync(join(ROOT, 'data', 'translation'), join(dir, 'data', 'translation'), { recursive: true });
  return dir;
}
function runIsolatedPrepare(dir) {
  const proc = spawnSync(process.execPath, [join(dir, 'tools', 'prepare-data.mjs')], {
    cwd: dir, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  return { code: proc.status, output: `${proc.stdout ?? ''}${proc.stderr ?? ''}` };
}
function cleanupIsolated(dir) {
  if (dir.startsWith(tmpdir()) && dir.includes('cs2-verify-')) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
if (SKIP_NEGATIVE) {
  unverifiedCheck('隔离负向测试', 'CS2_SKIP_NEGATIVE=1，本次运行跳过');
} else {
  // N1：撤销一处修复（改坏隔离副本里的 WIKI_ROW_REPAIRS 取值）→ 必须失败
  {
    const dir = isolatedCopy('n1');
    const file = join(dir, 'tools', 'prepare-data.mjs');
    let src = readFileSync(file, 'utf8');
    const needle = "tv_broadcast_url: {\n    defaultValue: 'http://localhost:8080',";
    const replacement = "tv_broadcast_url: {\n    defaultValue: 'http://localhost:9999',";
    if (src.includes(needle)) src = src.replace(needle, replacement);
    else src = src.replace("defaultValue: 'http://localhost:8080',", "defaultValue: 'http://localhost:9999',");
    writeFileSync(file, src, 'utf8');
    const res = runIsolatedPrepare(dir);
    const hit = /repaired default value of tv_broadcast_url/.test(res.output);
    negativeTests.push({
      id: 'N1', desc: '撤销一处修复（tv_broadcast_url → http://localhost:9999）', scope: 'prepare-data.mjs',
      exitCode: res.code, failedAsExpected: res.code !== 0 && hit,
      evidence: clip(res.output.split('\n').filter((l) => /FAIL|repaired default value/.test(l)).join(' | '), 400),
    });
    check('负向测试 N1：撤销修复 ⇒ prepare-data 退出码非 0 且指出具体行',
      res.code !== 0 && hit, `exit=${res.code} :: ${clip(res.output.split('\n').filter((l) => /FAIL/.test(l)).join(' | '), 300)}`);
    cleanupIsolated(dir);
  }
  // N2：向隔离副本注入一条未登记的新坏行 → 必须失败
  {
    const dir = isolatedCopy('n2');
    const rawPath = join(dir, 'data', 'cs2-commands.raw.json');
    const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
    raw.commands.push({
      id: 99999, command: 'zzz_verify_injected_runon', defaultValue: 'http',
      flags: ['//injected'], description: '8080 : release : Injected corrupt row', section: 'Z',
    });
    writeFileSync(rawPath, JSON.stringify(raw, null, 2), 'utf8');
    const res = runIsolatedPrepare(dir);
    const hit = /zzz_verify_injected_runon is enumerated in WIKI_ROW_REPAIRS/.test(res.output);
    negativeTests.push({
      id: 'N2', desc: '注入未登记的新坏行（&#160;: run-on 形态）', scope: 'prepare-data.mjs',
      exitCode: res.code, failedAsExpected: res.code !== 0 && hit,
      evidence: clip(res.output.split('\n').filter((l) => /FAIL/.test(l)).join(' | '), 400),
    });
    check('负向测试 N2：注入未登记坏行 ⇒ prepare-data 直接失败（不静默放过）',
      res.code !== 0 && hit, `exit=${res.code} :: ${clip(res.output.split('\n').filter((l) => /FAIL/.test(l)).join(' | '), 300)}`);
    cleanupIsolated(dir);
  }
  // N3：**反向回归用例**（t7 原始版本断言「该形态会被静默放过」，用来证明坏行检测存在盲区）。
  //     t10 已用与判据 A/B 正交的「错位防护」封死该盲区，因此本用例已反转为：
  //     该反例现在**必须被拒绝**（exit≠0 且失败信息点名该行），而旧判据 A/B 依然命中不了它
  //     —— 这样它从「证明有漏洞」变成「证明漏洞已封死且是新增判据在起作用」。
  //     隔离副本里把 EXPECTED_COMMANDS 调成 2529（真实数据不受影响）；探针命令名以 zzz_ 开头，
  //     追加在字母序末尾，不会挪动 EXPECTED_SOURCE_DEFECTS 依赖的描述索引。
  {
    const dir = isolatedCopy('n3');
    const prepPath = join(dir, 'tools', 'prepare-data.mjs');
    const prepSrc = readFileSync(prepPath, 'utf8');
    writeFileSync(prepPath, prepSrc.replace('const EXPECTED_COMMANDS = 2528;', 'const EXPECTED_COMMANDS = 2529;'), 'utf8');
    const rawPath = join(dir, 'data', 'cs2-commands.raw.json');
    const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
    const probe = {
      id: 99998, command: 'zzz_verify_gap_probe', defaultValue: 'cl',
      flags: ['sv'], description: 'x] : Some description.', section: 'Z',
    };
    raw.commands.push(probe);
    writeFileSync(rawPath, JSON.stringify(raw, null, 2), 'utf8');
    const res = runIsolatedPrepare(dir);
    const rejected = res.code !== 0;
    const rejectsByGuard = /REFUSING TO RUN/.test(res.output); // 「防误删译文」守卫（本副本无 data/commands.json，正常不应触发）
    const namesRow = res.output.includes(probe.command);
    const byMisalignment = /misaligned|bare engine-flag token|value duplicated into the Flags cell/i.test(res.output);
    const failLine = res.output.split('\n').map((l) => l.trim()).find((l) => l.startsWith('FAILED') && l.includes(probe.command)) ?? '';
    // 旧的两级判据对该形态**依然**命中不了（这是「盲区」的定义）
    const badFlags = probe.flags.filter((f) => !FLAG_SET.has(f));
    const parts = splitRunOn(probe.description);
    const runOnFlags = splitFlagCell(parts[parts.length - 2] ?? '').filter((f) => FLAG_SET.has(f));
    const prepareDetects = parts.length > 1 && (badFlags.length > 0 || runOnFlags.length > 0);
    const htmlCriterionA = RAW_MARKER.test(probe.description);
    const htmlCriterionB = probe.flags.some((f) => !FLAG_SET.has(f));
    const outputDatasetRow = (() => {
      try {
        const ds = JSON.parse(readFileSync(join(dir, 'data', 'commands.json'), 'utf8'));
        return ds.commands.find((c) => c.command === probe.command) ?? null;
      } catch { return null; }
    })();
    negativeTests.push({
      id: 'N3', kind: 'reverse-regression',
      desc: 't7 构造的盲区反例（无 nbsp 标记 + flags 列全为白名单）：现在必须被拒绝，且失败信息点名该行',
      scope: 'prepare-data.mjs 新增的正交「错位防护」判据',
      exitCode: res.code, rejected, rejectsByGuard, namesRow, byMisalignment, failLine,
      failedAsExpected: rejected && namesRow,
      legacyPrepareDetects: prepareDetects, htmlCriterionA, htmlCriterionB,
      blindSpotClosed: rejected && namesRow && !rejectsByGuard && !prepareDetects && !htmlCriterionA && !htmlCriterionB,
      outputDatasetRow,
      evidence: clip(res.output.split('\n').filter((l) => /FAIL|BUILD FAILED/.test(l)).join(' | '), 400),
    });
    out(`  N3 反向回归：prepare-data 退出码=${res.code}（拒绝=${rejected}，点名该行=${namesRow}，来自新增错位判据=${byMisalignment}，误触发防误删守卫=${rejectsByGuard}）`);
    out(`     探针输入：defaultValue="cl"（其实是取值片段）、flags=[sv]（全白名单）、description="x] : Some description."（无 &#160; 标记）`);
    out(`     旧判据是否仍命中：prepare 的 run-on 判据=${prepareDetects}、HTML 判据A=${htmlCriterionA}、判据B=${htmlCriterionB}（全为 false ⇒ 确属原盲区）`);
    out(`     失败信息：${clip(failLine, 220)}`);
    out(`     是否产出污染行：${JSON.stringify(outputDatasetRow)}`);
    check('负向测试 N3（反向回归）：t7 的盲区反例现在必须被 prepare-data 拒绝，退出码非 0 且失败信息点名该行',
      rejected && namesRow, `exit=${res.code} :: ${clip(failLine, 300)}`);
    check('N3 的拒绝来自 t10 新增的正交「错位防护」判据，而不是误触发「防误删译文」守卫或计数断言',
      byMisalignment && !rejectsByGuard, `byMisalignment=${byMisalignment} rejectsByGuard=${rejectsByGuard} :: ${clip(failLine, 200)}`);
    check('N3：该形态确实不被旧的两级判据覆盖（盲区定义成立），盲区现已封死',
      !prepareDetects && !htmlCriterionA && !htmlCriterionB &&
      negativeTests[negativeTests.length - 1].blindSpotClosed,
      `prepareDetects=${prepareDetects} A=${htmlCriterionA} B=${htmlCriterionB}`);
    cleanupIsolated(dir);
  }
  extra.negativeTests = negativeTests;
  check('负向测试 N1/N2/N3 均按预期失败（N3 为反向回归：必须被拒绝）',
    negativeTests.filter((n) => ['N1', 'N2', 'N3'].includes(n.id)).every((n) => n.failedAsExpected));
}

/* =========================================================== S12 占位符保真 */
section('S12 占位符/标识符保真（中英文逐字一致）');
const tokenStrict = (text) => {
  const found = [];
  for (const m of String(text).matchAll(/\{[^{}]*\}/g)) found.push(m[0]);
  for (const m of String(text).matchAll(/<[^<>]*>/g)) found.push(m[0]);
  return found;
};
/**
 * 方括号占位符。注意：`[<player name or index>]` 这种「方括号只是包住另一个占位符」的
 * 写法不算方括号占位符，否则会把内层 token 重复计一遍（md 也只声明内层 token）。
 */
const tokenBracket = (text) => [...String(text).matchAll(/\[[^[\]]*\]/g)]
  .map((m) => m[0])
  .filter((t) => !/^(<[^<>]*>|\{[^{}]*\})$/.test(t.slice(1, -1).trim()));
const percentTokens = (text) => [...String(text).matchAll(/%[0-9a-zA-Z_]/g)].map((m) => m[0]);

const strictOccurrences = new Map();
let strictDescriptions = 0;
const strictProblems = [];
const strictAdded = [];
for (const c of withEn) {
  const enTokens = tokenStrict(c.descriptionEn);
  if (enTokens.length === 0) continue;
  strictDescriptions += 1;
  const zhSet = new Set(tokenStrict(c.descriptionZh));
  const enSet = new Set(enTokens);
  for (const t of enTokens) strictOccurrences.set(t, (strictOccurrences.get(t) ?? 0) + 1);
  const missing = [...enSet].filter((t) => !zhSet.has(t));
  const added = [...zhSet].filter((t) => !enSet.has(t));
  if (missing.length) strictProblems.push({ command: c.command, tokens: missing, en: c.descriptionEn, zh: c.descriptionZh });
  if (added.length) strictAdded.push({ command: c.command, tokens: added, en: c.descriptionEn, zh: c.descriptionZh });
}
const strictTotal = [...strictOccurrences.values()].reduce((a, b) => a + b, 0);
info(`{} 与 <> 两类占位符：涉及 ${strictDescriptions} 条命令，${strictOccurrences.size} 种，${strictTotal} 处`);
check('所有 {} / <> 占位符在中文里逐字保留（集合完全相同，无丢失）', strictProblems.length === 0,
  strictProblems.slice(0, 6).map((p) => `${p.command}:${p.tokens.join('/')}`).join(', '));
check('中文没有凭空多出 {} / <> 占位符', strictAdded.length === 0,
  strictAdded.slice(0, 6).map((p) => `${p.command}:${p.tokens.join('/')}`).join(', '));

const bracketProblems = [];
const bracketOccurrences = new Map();
let bracketDescriptions = 0;
for (const c of withEn) {
  const enTokens = tokenBracket(c.descriptionEn);
  if (enTokens.length === 0) continue;
  bracketDescriptions += 1;
  const zhSet = new Set(tokenBracket(c.descriptionZh));
  for (const t of enTokens) bracketOccurrences.set(t, (bracketOccurrences.get(t) ?? 0) + 1);
  const missing = [...new Set(enTokens)].filter((t) => !zhSet.has(t));
  if (missing.length) bracketProblems.push({ command: c.command, tokens: missing, en: c.descriptionEn, zh: c.descriptionZh });
}
info(`[] 方括号占位符：涉及 ${bracketDescriptions} 条命令，${bracketOccurrences.size} 种，${[...bracketOccurrences.values()].reduce((a, b) => a + b, 0)} 处；其中 ${bracketProblems.length} 条的中文方括号内容被意译`);
for (const p of bracketProblems) {
  out(`    · 方括号被意译：${p.command}  ${p.tokens.join(' / ')}`);
  out(`        EN: ${clip(p.en, 160)}`);
  out(`        ZH: ${clip(p.zh, 160)}`);
}
extra.bracketDeviations = bracketProblems;
/**
 * 已知的方括号意译清单。captain 只点名了 3 条（索引 184/187 + crosshair 一处），
 * 独立复算发现还有第 4 种英文原文 `[mod authors use this]` 也被意译（并被换成了全角
 * ［］），影响 2 条命令 —— 已作为 finding 登记。此断言写死集合本身：
 * 一旦再出现新的方括号意译、或某一处被修回逐字保留，都会失败，逼人对齐清单。
 */
const KNOWN_BRACKET_DEVIATIONS = [
  'cl_crosshair_dynamic_maxdist_splitratio', 'cl_ent_text256', 'cl_ent_text_radius',
  'ent_text256', 'ent_text_radius', 'sv_disable_immunity_alpha',
].sort();
const deviationNames = bracketProblems.map((p) => p.command).sort();
check('方括号内容被意译的条目集合 === 已知清单（captain 裁定 3 条 + 本次新发现的 sv_disable_immunity_alpha）',
  JSON.stringify(deviationNames) === JSON.stringify(KNOWN_BRACKET_DEVIATIONS), deviationNames.join(', '));
const bracketAffectsCopy = bracketProblems.some((p) => {
  const row = byCommand.get(p.command);
  return /[[\]]/.test(String(row?.defaultValue ?? ''));
});
check('方括号意译不会进入任何可复制字符串（相关命令的 defaultValue 不含方括号）', !bracketAffectsCopy,
  bracketProblems.map((p) => p.command).join(', '));

const percentInEn = commands.filter((c) => percentTokens(c.descriptionEn).length > 0);
const percentMismatch = percentInEn.filter((c) => percentTokens(c.descriptionEn).join(',') !== percentTokens(c.descriptionZh).join(','));
info(`含 %s/%1 类占位符的命令 ${percentInEn.length} 条`);
check('%s / %1 类占位符在中文里逐字保留', percentMismatch.length === 0,
  percentMismatch.slice(0, 5).map((c) => c.command).join(', '));

const declared = new Map();
for (const line of readFileSync(TOKENS_MD_PATH, 'utf8').split('\n')) {
  const m = /^\|\s*`(.+?)`\s*\|\s*(\d+)\s*\|/.exec(line);
  if (m) declared.set(m[1].replace(/\\\\/g, '\\'), Number(m[2]));
}
const declaredTotal = [...declared.values()].reduce((a, b) => a + b, 0);
info(`parameter-tokens.md 声明 ${declared.size} 种 / ${declaredTotal} 处`);
const measuredUnion = new Set([...strictOccurrences.keys(), ...bracketOccurrences.keys()]);
info(`实测（按命令计）：${measuredUnion.size} 种；{}<>+[] 合计 ${strictTotal + [...bracketOccurrences.values()].reduce((a, b) => a + b, 0)} 处`);
const uniqueDescriptions = [...new Set(withEn.map((c) => c.descriptionEn))];
const uniqueOcc = new Map();
for (const en of uniqueDescriptions) {
  for (const t of [...tokenStrict(en), ...tokenBracket(en)]) uniqueOcc.set(t, (uniqueOcc.get(t) ?? 0) + 1);
}
const uniqueTotal = [...uniqueOcc.values()].reduce((a, b) => a + b, 0);
info(`实测（按唯一描述计）：${uniqueOcc.size} 种 / ${uniqueTotal} 处`);
const declaredMissing = [...declared.keys()].filter((t) => !measuredUnion.has(t));
check('md 声明的占位符都能在数据里找到（无凭空声明）', declaredMissing.length === 0, declaredMissing.slice(0, 8).join(' | '));
const undeclaredTokens = [...measuredUnion].filter((t) => !declared.has(t));
check('数据里的占位符都在 md 声明中（无漏登记）', undeclaredTokens.length === 0, undeclaredTokens.slice(0, 8).join(' | '));
// 逐 token 复算出现次数：md 的计数口径是「在唯一描述集合上做最左非重叠匹配」
// （`[\[{]([^{}\[\]<>]*)[\]}]|<([^<>]*)>`），因此 `<{entity_name} / {class_name} / …>` 这种
// 组会被算成 1 个复合 token，而不是把里面的 4 个 token 各算一次。
const perCommandOcc = new Map();
for (const c of withEn) {
  for (const t of [...tokenStrict(c.descriptionEn), ...tokenBracket(c.descriptionEn)]) {
    perCommandOcc.set(t, (perCommandOcc.get(t) ?? 0) + 1);
  }
}
const legendRule = (text) => String(text).match(/[\[{]([^{}\[\]<>]*)[\]}]|<([^<>]*)>/g) ?? [];
const legendOcc = new Map();
for (const en of uniqueDescriptions) {
  for (const token of legendRule(en)) legendOcc.set(token, (legendOcc.get(token) ?? 0) + 1);
}
const legendTotal = [...legendOcc.values()].reduce((a, b) => a + b, 0);
const countMismatch = [...declared.entries()].filter(([token, count]) => count !== (legendOcc.get(token) ?? 0));
extra.placeholderCounts = {
  legendRuleKinds: legendOcc.size,
  legendRuleTotal: legendTotal,
  declaredKinds: declared.size,
  declaredTotal,
  naiveUniqueBasisTotal: uniqueTotal,
  naivePerCommandTotal: [...perCommandOcc.values()].reduce((a, b) => a + b, 0),
  mismatches: countMismatch.map(([token, count]) => ({ token, declared: count, legendRule: legendOcc.get(token) ?? 0 })),
};
info(`逐 token 出现次数：md 声明合计 ${declaredTotal}；按 md 口径（唯一描述 + 最左非重叠匹配）复算合计 ${legendTotal}；`
  + `朴素口径按唯一描述 ${uniqueTotal} 处 / 按命令 ${extra.placeholderCounts.naivePerCommandTotal} 处（差异来自嵌套 token 与重复描述）`);
check('md 每个 token 的出现次数都能被「唯一描述 + 最左非重叠匹配」口径精确复算（声明无臆造）',
  countMismatch.length === 0 && legendOcc.size === declared.size,
  countMismatch.map(([t, n]) => `${t}: md=${n} recomputed=${legendOcc.get(t) ?? 0}`).join(' | '));

// 交叉核对：chunks 里的唯一描述集合必须与 dataset 完全一致（否则计数口径无从谈起）
const chunkDescriptions = [];
for (let i = 1; i <= 10; i += 1) {
  const chunkPath = join(ROOT, 'data', 'translation', 'chunks', `chunk-${String(i).padStart(3, '0')}.json`);
  const chunk = JSON.parse(readFileSync(chunkPath, 'utf8'));
  chunkDescriptions.push(...chunk.descriptions);
}
const chunkUnique = new Set(chunkDescriptions);
const dsUnique = new Set(uniqueDescriptions);
const chunkOnly = [...chunkUnique].filter((d) => !dsUnique.has(d));
const dsOnly = [...dsUnique].filter((d) => !chunkUnique.has(d));
info(`chunks 描述总数 ${chunkDescriptions.length}，唯一 ${chunkUnique.size}；dataset 唯一 ${dsUnique.size}`);
check('chunks 的唯一描述集合 === dataset 的唯一描述集合（翻译工作单元未错位）',
  chunkOnly.length === 0 && dsOnly.length === 0 && chunkDescriptions.length === 1465,
  `chunkOnly=${chunkOnly.length} dsOnly=${dsOnly.length} total=${chunkDescriptions.length}`);
extra.placeholders = {
  strict: { descriptions: strictDescriptions, kinds: strictOccurrences.size, total: strictTotal },
  bracket: { descriptions: bracketDescriptions, kinds: bracketOccurrences.size },
  unions: { measuredUnion: measuredUnion.size, declaredKinds: declared.size, declaredTotal, uniqueKinds: uniqueOcc.size, uniqueTotal },
  strictProblems, strictAdded, bracketProblems, undeclaredTokens, declaredMissing,
  kinds: [...strictOccurrences.entries()].sort((a, b) => b[1] - a[1]).map(([token, count]) => ({ token, count })),
};

const bsEn = commands.filter((c) => c.descriptionEn.includes('\\|'));
const allBackslash = commands.reduce((acc, c) => acc + (c.descriptionEn.match(/\\\|/g)?.length ?? 0), 0);
const allBackslashZh = commands.reduce((acc, c) => acc + (c.descriptionZh.match(/\\\|/g)?.length ?? 0), 0);
info(`描述含 "\\|" 的命令 ${bsEn.length} 条：${bsEn.map((c) => c.command).join(', ')}；全库 EN 中出现 ${allBackslash} 处，ZH ${allBackslashZh} 处`);
extra.backslash = { commands: bsEn.map((c) => c.command), inEn: allBackslash, inZh: allBackslashZh };
check('<t\\|ct> 的反斜杠未被擦除（英文 2 条、中文同样 2 条且含反斜杠）',
  bsEn.length === 2 && bsEn.every((c) => c.descriptionZh.includes('<t\\|ct>')),
  bsEn.map((c) => `${c.command}:${c.descriptionZh.includes('\\|')}`).join(','));
check('全库 descriptionZh 中 "\\|" 的出现次数与 descriptionEn 相同（无一处被擦成 "|"）',
  allBackslash === allBackslashZh, `EN=${allBackslash} ZH=${allBackslashZh}`);

/* ================================================= S13 源站缺陷台账独立复核 */
section('S13 meta.sourceDefects 独立复核（源站原文残缺，不是翻译缺陷）');
const defectEntries = meta.sourceDefects?.entries ?? [];
info(`meta.sourceDefects.count=${meta.sourceDefects?.count}；entries=${defectEntries.length}`);
check('sourceDefects.count === entries.length', meta.sourceDefects?.count === defectEntries.length);
const indexToDescription = new Map();
{
  const seen = new Set();
  let idx = 0;
  for (const c of commands) {
    if (c.descriptionEn === '' || seen.has(c.descriptionEn)) continue;
    seen.add(c.descriptionEn);
    indexToDescription.set(idx, c.descriptionEn);
    idx += 1;
  }
}
const indexMismatch = defectEntries.filter((e) => indexToDescription.get(e.index) !== e.descriptionEn);
check('每条形缺条目的 index 都能命中同文本的唯一描述（索引契约正确）', indexMismatch.length === 0,
  indexMismatch.slice(0, 3).map((e) => `${e.index}`).join(','));
const recalc = defectEntries.map((e) => {
  const en = e.descriptionEn;
  const opens = (en.match(/\(/g) ?? []).length;
  const closes = (en.match(/\)/g) ?? []).length;
  const recomputed = opens !== closes ? 'unbalanced-bracket'
    : (/\s\)/.test(en) || /\(\s/.test(en)) ? 'spacing-inside-parens'
      : /s's\b/.test(en) ? 'possessive-s'
        : /\b(\w+) \1\b/.test(en) ? 'duplicate-word'
          : /\.\.[^.]|\.\.$/.test(en) ? 'duplicate-punctuation'
            : /\.[A-Z]/.test(en) ? 'missing-space-after-sentence'
              : 'none';
  return { index: e.index, declared: e.type, recomputed, en: clip(en, 90) };
});
extra.sourceDefects = recalc;
out('  --- meta.sourceDefects 逐条（declared vs 我的独立复算）---');
for (const r of recalc) out(`    [${r.index}] ${r.declared.padEnd(30)} recomputed=${r.recomputed.padEnd(30)} ${clip(r.en, 90)}`);
const recalcMismatch = recalc.filter((r) => r.recomputed !== r.declared);
check('6 类可独立判定的残缺（括号/括号内空格/所有格/重复词/重复标点/句末缺空格）复算结果与 meta 声明一致',
  recalcMismatch.length === 0, recalcMismatch.map((r) => `[${r.index}]${r.declared}!=${r.recomputed}`).join(', '));
const defectHtmlCheck = defectEntries.map((e) => {
  const owner = commands.find((c) => c.descriptionEn === e.descriptionEn);
  const row = dataRows.find((r) => r.text[0] === owner?.command);
  return {
    index: e.index, command: owner?.command,
    htmlHasSameText: row ? row.text[3] === e.descriptionEn : false,
    rawCell: row ? clip(row.raw[3], 160) : null,
  };
});
extra.sourceDefectsHtml = defectHtmlCheck;
check('13 条残缺在 HTML 原文里逐字一致（残缺来自源站，不是解析或翻译引入）',
  defectHtmlCheck.every((d) => d.htmlHasSameText && d.rawCell),
  defectHtmlCheck.filter((d) => !d.htmlHasSameText).map((d) => `[${d.index}]${d.command}`).join(', '));

/* ================================================================== 汇总 */
section('汇总');
const failed = checks.filter((c) => !c.ok);
const bySection = {};
for (const c of checks) {
  bySection[c.section] ??= { pass: 0, fail: 0 };
  bySection[c.section][c.ok ? 'pass' : 'fail'] += 1;
}
out(`  通过 ${checks.length - failed.length} / ${checks.length}；失败 ${failed.length}；未验证 ${unverified.length}`);
for (const [sec, stat] of Object.entries(bySection)) out(`    ${sec.padEnd(56)} pass=${stat.pass} fail=${stat.fail}`);
if (failed.length) {
  out('  失败清单：');
  for (const f of failed) out(`    [FAIL] ${f.section} :: ${f.name} :: ${f.detail}`);
}
out(`  未验证清单：${unverified.length === 0 ? '(none)' : ''}`);
for (const u of unverified) out(`    [UNVERIFIED] ${u.name} :: ${u.reason}`);

const summary = {
  generatedAt: new Date().toISOString(),
  seed: SEED,
  node: process.version,
  inputs: {
    commandsJson: { bytes: dataBuf.length, sha256: sha256(dataBuf) },
    wikiHtml: { bytes: htmlBuf.length, sha256: sha256(htmlBuf) },
    appPublicCopySha256: copyBuf ? sha256(copyBuf) : null,
    distCopySha256: existsSync(DIST_DATA_PATH) ? sha256(readFileSync(DIST_DATA_PATH)) : null,
  },
  totals: { checks: checks.length, passed: checks.length - failed.length, failed: failed.length, unverified: unverified.length },
  bySection,
  failures: failed,
  unverified,
  samples,
  details: extra,
};
writeFileSync(REPORT_JSON, JSON.stringify(summary, null, 2), 'utf8');
writeFileSync(REPORT_TXT, `${LOG.join('\n')}\n`, 'utf8');
out('');
out(`报告已写出：${relative(ROOT, REPORT_TXT)} / ${relative(ROOT, REPORT_JSON)}`);
out(failed.length === 0 ? 'RESULT: ALL CHECKS PASS' : `RESULT: ${failed.length} CHECK(S) FAILED`);
process.exitCode = failed.length === 0 ? 0 : 1;
