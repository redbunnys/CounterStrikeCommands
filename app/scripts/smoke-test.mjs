#!/usr/bin/env node
/**
 * CS2 命令查询前端 —— 可重复运行的自测脚本（纯 Node 标准库，无第三方依赖）。
 *
 * 它做三件事：
 *  1) 真起一个服务器（默认 `vite preview`，可用 --dev 切到 dev server，或用 --base 复用已有服务），
 *     通过 HTTP 验证：页面能加载、/data/commands.json 能加载、条数 2528、构建产物可访问。
 *  2) 直接复用前端源码里的纯函数（app/src/lib/filter.ts、app/src/lib/copy.ts，靠 Node 类型擦除直接 import .ts），
 *     用真实数据验证搜索/筛选语义与复制字符串拼装。
 *  3) 若本机有 Chrome/Edge，用无头浏览器 dump 真实渲染后的 DOM，验证应用真的渲染出了命令列表
 *     （而不是白屏或只有错误卡片）；找不到浏览器时该项显示 [SKIP]。
 *
 * 用法：
 *   node app/scripts/smoke-test.mjs                # 起 vite preview（需先 pnpm build）
 *   node app/scripts/smoke-test.mjs --dev          # 起 vite dev
 *   node app/scripts/smoke-test.mjs --base http://127.0.0.1:4173
 *   node app/scripts/smoke-test.mjs --port 4399
 *   node app/scripts/smoke-test.mjs --no-browser   # 跳过无头浏览器 DOM 检查
 *   node app/scripts/smoke-test.mjs --browser "C:\\path\\to\\chrome.exe"
 *
 * 退出码：全部通过（或仅有 SKIP）0，任一 FAIL 1。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const filterLib = await import(new URL('../src/lib/filter.ts', import.meta.url).href);
const copyLib = await import(new URL('../src/lib/copy.ts', import.meta.url).href);
const placeholderLib = await import(new URL('../src/lib/placeholders.ts', import.meta.url).href);
const { filterCommands, EMPTY_FILTERS, hasActiveFilters } = filterLib;
const { buildCommandLine, buildBatchText, buildCfgFile, valueForCommand } = copyLib;
const { PLACEHOLDER_TOKENS, renderPlaceholderSegments, placeholderMeaning } = placeholderLib;

const FLAG_WHITELIST = [
  'sv', 'cl', 'rep', 'cheat', 'release', 'nf', 'a', 'per_user', 'user', 'norecord',
  'sp', 'demo', 'nolog', 'server_can_execute', 'clientcmd_can_execute', 'vconsole_fuzzy',
  'vconsole_set_focus', 'server_cant_query', 'prot', 'execute_per_tick', 'disconnected',
];
const EXPECTED_COMMANDS = 2528;

/** dev 模式下 HTML 直接引用源码模块，文案检查覆盖这些模块 */
const DEV_SOURCE_MODULES = [
  '/app/src/main.tsx',
  '/app/src/App.tsx',
  '/app/src/components/CommandList.tsx',
  '/app/src/components/FilterPanel.tsx',
  '/app/src/components/PlaceholderText.tsx',
  '/app/src/components/ParameterTokenGlossary.tsx',
  '/app/src/components/Toast.tsx',
  '/app/src/components/ErrorBoundary.tsx',
  '/app/src/hooks/useDataset.ts',
];
/** 必须出现在前端代码里的关键文案（复制反馈 / 中文回退 / 空态 / 错误态） */
const REQUIRED_COPY_TOKENS = [
  '已复制',
  '英文原文',
  '没有匹配的命令',
  '数据加载失败',
  '清空筛选',
  '复制命令+值',
  '参数占位符',
];

const BROWSER_CANDIDATES = [
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
].filter((candidate) => candidate.trim() !== '');

// ---------------------------------------------------------------- CLI 参数
const argv = process.argv.slice(2);
const useDev = argv.includes('--dev');
const skipBrowser = argv.includes('--no-browser');
const baseArgIndex = argv.indexOf('--base');
const explicitBase = baseArgIndex >= 0 ? argv[baseArgIndex + 1] : null;
const portArgIndex = argv.indexOf('--port');
const port = portArgIndex >= 0 ? Number(argv[portArgIndex + 1]) : useDev ? 5173 : 4173;
const browserArgIndex = argv.indexOf('--browser');
const explicitBrowser = browserArgIndex >= 0 ? argv[browserArgIndex + 1] : null;

// ---------------------------------------------------------------- 迷你断言框架
const results = [];
let currentSection = '';

function section(title) {
  currentSection = title;
  console.log(`\n== ${title} ==`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    if (detail && typeof detail === 'object' && detail.skipped) {
      results.push({ section: currentSection, name, ok: true, skipped: true, detail: detail.reason });
      console.log(`  [SKIP] ${name} — ${detail.reason}`);
      return;
    }
    results.push({ section: currentSection, name, ok: true, detail });
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ section: currentSection, name, ok: false, detail: message });
    console.log(`  [FAIL] ${name} — ${message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function fmt(value) {
  return JSON.stringify(value);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 本地冻结数据集（唯一真相）；app/public 下的副本仅作回退 */
const LOCAL_DATASET = resolve(projectRoot, 'data/commands.json');

// ---------------------------------------------------------------- 服务器管理
let serverProcess = null;

async function waitForServer(base, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/data/commands.json`, { cache: 'no-store' });
      if (response.ok) return true;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  }
  throw new Error(`等待 ${base} 就绪超时（最后错误：${lastError}）`);
}

async function startServer() {
  const viteBin = resolve(projectRoot, 'node_modules/vite/bin/vite.js');
  assert(existsSync(viteBin), `找不到 vite：${viteBin}（请先运行 pnpm install）`);
  if (!useDev) {
    const distIndex = resolve(projectRoot, 'dist/index.html');
    assert(
      existsSync(distIndex),
      `preview 需要已构建的产物：${distIndex} 不存在，请先运行 pnpm build（或改用 --dev）`,
    );
  }
  const args = useDev
    ? [viteBin, '--port', String(port), '--strictPort', '--host', '127.0.0.1']
    : [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  serverProcess = spawn(process.execPath, args, {
    cwd: projectRoot,
    stdio: 'ignore',
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);
  return base;
}

/** 结束本次启动的服务器进程（含其子进程），避免端口被占用影响下一次运行。 */
function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const pid = serverProcess.pid;
  try {
    serverProcess.kill();
  } catch {
    /* 忽略：进程可能已退出 */
  }
  if (process.platform === 'win32' && pid) {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* 忽略 */
    }
  }
}

// ---------------------------------------------------------------- 无头浏览器
function findBrowser() {
  if (explicitBrowser) return existsSync(explicitBrowser) ? explicitBrowser : null;
  return BROWSER_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

// ---------------------------------------------------------------- CDP 交互测试
function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** 删除临时目录：Chrome 退出后短时间内可能仍占用文件，重试若干次并容忍失败。 */
async function safeRemove(dir) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300);
    }
  }
}

async function pollJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  throw new Error(`轮询 ${url} 超时：${lastError}`);
}

/**
 * 用 Chrome DevTools Protocol 驱动真实页面做交互测试：
 * 搜索过滤 → 点「复制命令+值」→ 校验 toast 与剪贴板内容 → Esc 清空 → 预设筛选 → 勾选批量复制。
 * 需要浏览器支持；失败会以 [FAIL] 呈现，连不上 CDP 时以 [SKIP] 呈现。
 */
async function runInteractiveChecks(browser, base, commands) {
  const port = 9000 + Math.floor(Math.random() * 900);
  const dir = mkdtempSync(join(tmpdir(), 'cs2-cdp-'));
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(dir, 'profile')}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  try {
    await pollJson(`http://127.0.0.1:${port}/json/version`, 45000);
    const created = await (
      await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${base}/`)}`, { method: 'PUT' })
    ).json();
    const ws = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((resolvePromise, rejectPromise) => {
      ws.onopen = () => resolvePromise();
      ws.onerror = () => rejectPromise(new Error('CDP WebSocket 连接失败'));
    });

    let messageId = 0;
    const pendingCalls = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pendingCalls.has(message.id)) {
        const { resolve: resolvePromise, reject: rejectPromise } = pendingCalls.get(message.id);
        pendingCalls.delete(message.id);
        if (message.error) rejectPromise(new Error(`CDP ${message.error.message}`));
        else resolvePromise(message.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolvePromise, rejectPromise) => {
        messageId += 1;
        pendingCalls.set(messageId, { resolve: resolvePromise, reject: rejectPromise });
        ws.send(JSON.stringify({ id: messageId, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description ?? '页面脚本抛出异常';
        throw new Error(detail.split('\n')[0]);
      }
      return result.result.value;
    };
    const waitInPage = async (expression, label, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return true;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
      }
      throw new Error(`等待页面条件超时：${label}`);
    };

    await send('Runtime.enable');
    await send('Browser.grantPermissions', {
      origin: base,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
    await waitInPage('document.querySelectorAll("[data-command]").length >= 80', '首屏渲染 80 行');

    const setSearch = (value) =>
      evaluate(`(() => {
        const input = document.querySelector('.search-bar__input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
    const countText = () => evaluate('document.querySelector(".search-bar__count").textContent');
    const firstRow = () =>
      evaluate('document.querySelector("[data-command]").getAttribute("data-command")');

    const steps = [];

    // 1) 搜索过滤（sv_cheats 也会命中描述里提到它的命令，所以按命令定位行）
    const svCheatsRow = '[data-command="sv_cheats"]';
    await setSearch('sv_cheats');
    await waitInPage('document.querySelectorAll("[data-command]").length === 6', '搜索命中 6 行');
    assertEqual(await countText(), '筛选结果 6 / 2528 条', '搜索结果计数');
    assert(
      await evaluate(`!!document.querySelector('${svCheatsRow}')`),
      '搜索结果里没有 sv_cheats 行（可能命中的都是描述里提到它的命令）',
    );
    steps.push(`搜索 sv_cheats -> ${await countText()}，命中行含 sv_cheats 与描述命中项`);

    // 2) 点击「复制命令+值」，校验 toast 与剪贴板
    await evaluate(`document.querySelector('${svCheatsRow} .btn--primary').click()`);
    await waitInPage('!!document.querySelector(".toast")', '复制后的 toast');
    const toastText = await evaluate('document.querySelector(".toast").textContent');
    const clipboardText = await evaluate('navigator.clipboard.readText()');
    assert(toastText.includes('已复制'), `toast 文案异常：${toastText}`);
    assertEqual(clipboardText, 'sv_cheats false', '剪贴板内容（默认值 false 来自数据）');
    steps.push(`点击复制 -> toast「${toastText.replace('×', '').trim()}」，剪贴板 = ${JSON.stringify(clipboardText)}`);

    // 3) 编辑「值」后复制
    await evaluate(`(() => {
      const input = document.querySelector('${svCheatsRow} input[type="text"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await waitInPage(`document.querySelector('${svCheatsRow} input[type="text"]').value === '1'`, '值输入框生效');
    await evaluate(`document.querySelector('${svCheatsRow} .btn--primary').click()`);
    await waitInPage(`navigator.clipboard.readText().then((t) => t === 'sv_cheats 1')`, '剪贴板更新为 sv_cheats 1');
    steps.push('行内「值」改为 1 后复制 -> 剪贴板 = "sv_cheats 1"');

    // 4) Esc 清空搜索
    await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
    await waitInPage('document.querySelectorAll("[data-command]").length >= 80', 'Esc 后恢复全量');
    assertEqual(await countText(), '全部 2528 条', 'Esc 清空后的计数');
    steps.push(`Esc 清空搜索 -> ${await countText()}`);

    // 5) 预设筛选「仅显示作弊」
    await evaluate(`(() => {
      const chip = [...document.querySelectorAll('.chip--preset')].find((node) => node.textContent.includes('仅显示作弊'));
      chip.click();
      return true;
    })()`);
    const cheatOnly = filterCommands(commands, { ...EMPTY_FILTERS, flags: ['cheat'] });
    await waitInPage(
      `document.querySelector(".search-bar__count").textContent.includes("筛选结果 ${cheatOnly.length}")`,
      `仅显示作弊 ${cheatOnly.length} 条`,
    );
    const cheatBadges = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-command]')].slice(0, 5);
      return rows.every((row) => row.textContent.includes('作弊'));
    })()`);
    assert(cheatBadges, '筛选结果的前几行没有「作弊」标记');
    assertEqual(await firstRow(), cheatOnly[0].command, '作弊筛选的第一行');
    steps.push(`预设「仅显示作弊」 -> ${await countText()}（首行 ${await firstRow()}）`);

    // 6) 勾选 + 批量复制
    await evaluate('document.querySelector(".cmd-row input[type=\\"checkbox\\"]").click()');
    await waitInPage('!!document.querySelector(".batch-bar")', '批量条出现');
    const batchLabel = await evaluate('document.querySelector(".batch-bar__count").textContent');
    assert(batchLabel.includes('已选 1 条'), `批量条计数异常：${batchLabel}`);
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('.batch-bar .btn')].find((node) => node.textContent.includes('批量复制（命令+值）'));
      button.click();
      return true;
    })()`);
    const expectedBatchLine = buildCommandLine(cheatOnly[0].command, cheatOnly[0].defaultValue);
    const batchClipboard = await evaluate(
      'new Promise((resolve) => setTimeout(() => resolve(navigator.clipboard.readText()), 250))',
    );
    assertEqual(batchClipboard, expectedBatchLine, '批量复制内容');
    steps.push(`勾选 1 条 -> ${batchLabel} -> 批量复制 = ${JSON.stringify(batchClipboard)}`);

    ws.close();
    return steps.join(' · ');
  } finally {
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
    if (process.platform === 'win32' && child.pid) {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } catch {
        /* 忽略 */
      }
    }
    await sleep(600);
    await safeRemove(dir);
  }
}

/** 用无头浏览器加载页面并把渲染后的 DOM 落到临时文件（用文件描述符而不是管道） */async function dumpRenderedDom(browser, url) {
  const dir = mkdtempSync(join(tmpdir(), 'cs2-dom-'));
  const outFile = join(dir, 'dom.html');
  const fd = openSync(outFile, 'w');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--user-data-dir=' + join(dir, 'profile'),
    '--virtual-time-budget=10000',
    '--dump-dom',
    url,
  ];
  try {
    const child = spawn(browser, args, { stdio: ['ignore', fd, 'ignore'], windowsHide: true });
    const exitCode = await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* 忽略 */
        }
        resolvePromise(-1);
      }, 60000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolvePromise(code ?? -1);
      });
    });
    closeSync(fd);
    const dom = readFileSync(outFile, 'utf8');
    // 把渲染后的 DOM 存成证据，便于人工排查界面问题
    try {
      writeFileSync(
        resolve(projectRoot, `app/evidence/dom-${useDev ? 'dev' : 'preview'}.html`),
        dom,
        'utf8',
      );
    } catch {
      /* 证据写入失败不影响断言 */
    }
    assert(dom.length > 0, `无头浏览器没有输出 DOM（退出码 ${exitCode}）`);
    return dom;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* 已关闭 */
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
// ---------------------------------------------------------------- 主流程
let exitCode = 1;
try {
  console.log('CS2 命令查询前端 —— 自测脚本');
  console.log(`项目根目录：${projectRoot}`);

  const base = explicitBase ?? (await startServer());
  console.log(
    `服务器地址：${base}${explicitBase ? '（复用已有服务）' : useDev ? '（本次启动 vite dev）' : '（本次启动 vite preview）'}`,
  );

  // ---------- 1. HTTP / 静态资源 ----------
  section('1. 服务器与静态资源');

  let html = '';
  await check('GET / 返回 HTML 页面', async () => {
    const response = await fetch(`${base}/`, { cache: 'no-store' });
    assert(response.ok, `HTTP ${response.status}`);
    html = await response.text();
    assert(html.includes('id="root"'), 'HTML 里没有 #root 容器');
    return `${response.status}, ${html.length} 字节`;
  });

  await check('页面标题为中文标题', async () => {
    assert(html.includes('<title>CS2 控制台命令与变量查询（中文）</title>'), '未找到预期 <title>');
    return 'CS2 控制台命令与变量查询（中文）';
  });

  const entryAssets = [];
  await check('页面引用的脚本/样式资源可直接访问', async () => {
    for (const match of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|tsx|ts))"/g)) {
      entryAssets.push(match[1]);
    }
    assert(entryAssets.length >= 1, 'HTML 里没有找到任何脚本/样式入口');
    const sizes = [];
    for (const asset of entryAssets) {
      const response = await fetch(`${base}${asset}`, { cache: 'no-store' });
      assert(response.ok, `${asset} -> HTTP ${response.status}`);
      const body = await response.arrayBuffer();
      assert(body.byteLength > 100, `${asset} 体积异常：${body.byteLength} 字节`);
      sizes.push(`${asset} ${(body.byteLength / 1024).toFixed(1)} KB`);
    }
    return sizes.join(' · ');
  });

  await check('前端代码包含复制反馈与中文回退文案', async () => {
    const prodEntry = entryAssets.find((asset) => asset.startsWith('/assets/') && asset.endsWith('.js'));
    let combined = '';
    let origin = '';
    if (prodEntry) {
      const response = await fetch(`${base}${prodEntry}`, { cache: 'no-store' });
      assert(response.ok, `${prodEntry} -> HTTP ${response.status}`);
      combined = await response.text();
      origin = `构建产物 ${prodEntry}`;
    } else {
      // dev：逐个拉取被 Vite 转换后的源码模块
      const files = [...new Set([...entryAssets, ...DEV_SOURCE_MODULES])];
      for (const file of files) {
        const response = await fetch(`${base}${file}`, { cache: 'no-store' });
        assert(response.ok, `${file} -> HTTP ${response.status}`);
        combined += await response.text();
      }
      origin = `dev 模块 ${files.length} 个`;
    }
    const missing = REQUIRED_COPY_TOKENS.filter((token) => !combined.includes(token));
    assert(missing.length === 0, `缺少文案：${missing.join('、')}`);
    return `${origin}，包含 ${REQUIRED_COPY_TOKENS.length} 条关键文案`;
  });

  // ---------- 2. 数据契约 ----------
  section('2. 数据文件 /data/commands.json');

  let dataset = null;
  let servedDatasetBytes = null;
  await check('GET /data/commands.json 返回 JSON', async () => {
    const response = await fetch(`${base}/data/commands.json`, { cache: 'no-store' });
    assert(response.ok, `HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    servedDatasetBytes = Buffer.from(await response.arrayBuffer());
    const text = servedDatasetBytes.toString('utf8');
    assert(!text.startsWith('export default'), '响应被当作 ESM 模块返回（JSON 插件污染）');
    dataset = JSON.parse(text);
    return `${response.status}, ${contentType.split(';')[0]}, ${(servedDatasetBytes.length / 1024).toFixed(1)} KB`;
  });

  await check('服务端返回的数据与本地 data/commands.json 字节一致（sha256）', async () => {
    assert(servedDatasetBytes, '数据未取到');
    const localBytes = readFileSync(LOCAL_DATASET);
    const servedHash = sha256(servedDatasetBytes);
    const localHash = sha256(localBytes);
    assertEqual(servedDatasetBytes.length, localBytes.length, '字节数');
    assertEqual(servedHash, localHash, 'sha256');
    return `${LOCAL_DATASET} = ${servedHash.slice(0, 16)}… (${localBytes.length} 字节)，HTTP 响应字节完全相同`;
  });

  await check(`条数为 ${EXPECTED_COMMANDS}`, async () => {
    assert(Array.isArray(dataset.commands), 'commands 不是数组');
    assertEqual(dataset.commands.length, EXPECTED_COMMANDS, 'commands.length');
    assertEqual(dataset.meta.commands, EXPECTED_COMMANDS, 'meta.commands');
    return `${dataset.commands.length} 条（meta.commands=${dataset.meta.commands}）`;
  });

  await check('每条记录字段符合冻结契约', async () => {
    for (const entry of dataset.commands) {
      assert(typeof entry.id === 'number', `id 类型错误：${fmt(entry.id)}`);
      assert(typeof entry.command === 'string' && entry.command.length > 0, `command 非法：${entry.id}`);
      assert(entry.defaultValue === null || typeof entry.defaultValue === 'string', `defaultValue 非法：${entry.command}`);
      assert(Array.isArray(entry.flags), `flags 非数组：${entry.command}`);
      assert(typeof entry.descriptionEn === 'string', `descriptionEn 非法：${entry.command}`);
      assert(typeof entry.descriptionZh === 'string', `descriptionZh 非法：${entry.command}`);
      assert(typeof entry.section === 'string' && entry.section.length > 0, `section 非法：${entry.command}`);
    }
    return `字段齐全，键集合 = ${Object.keys(dataset.commands[0]).sort().join(', ')}`;
  });

  await check('id 为 1..2528 连续且 command 唯一、升序', async () => {
    const ids = dataset.commands.map((entry) => entry.id);
    assertEqual(new Set(ids).size, ids.length, 'id 唯一性');
    assertEqual(Math.min(...ids), 1, '最小 id');
    assertEqual(Math.max(...ids), EXPECTED_COMMANDS, '最大 id');
    const names = dataset.commands.map((entry) => entry.command);
    assertEqual(new Set(names).size, names.length, 'command 唯一性');
    for (let i = 1; i < names.length; i += 1) {
      assert(names[i - 1] <= names[i], `排序被破坏：${names[i - 1]} > ${names[i]}`);
    }
    return `id 1..${EXPECTED_COMMANDS} 连续，命令名唯一且升序`;
  });

  await check('flags 全部落在 21 条白名单内', async () => {
    const unknown = new Set();
    for (const entry of dataset.commands) {
      for (const flag of entry.flags) if (!FLAG_WHITELIST.includes(flag)) unknown.add(flag);
    }
    assertEqual(unknown.size, 0, `未知标记：${[...unknown].join(', ')}`);
    return `${dataset.commands.length} 条全部合规`;
  });

  // ---------- 3. 搜索 / 筛选 ----------
  section('3. 搜索 / 筛选（复用前端 app/src/lib/filter.ts 的真实实现）');

  const commands = dataset.commands;

  await check('搜索 sv_cheats 能命中该命令', async () => {
    const hits = filterCommands(commands, { ...EMPTY_FILTERS, query: 'sv_cheats' });
    const exact = hits.find((entry) => entry.command === 'sv_cheats');
    assert(exact, '结果里没有 sv_cheats');
    return `命中 ${hits.length} 条，含 sv_cheats（默认值 ${fmt(exact.defaultValue)}）`;
  });

  await check('搜索大小写不敏感（SV_CHEATS === sv_cheats）', async () => {
    const lower = filterCommands(commands, { ...EMPTY_FILTERS, query: 'sv_cheats' }).length;
    const upper = filterCommands(commands, { ...EMPTY_FILTERS, query: 'SV_CHEATS' }).length;
    assertEqual(upper, lower, '大小写敏感');
    return `两种写法都是 ${lower} 条`;
  });

  await check('搜索 mp_roundt 命中多轮时间相关命令', async () => {
    const hits = filterCommands(commands, { ...EMPTY_FILTERS, query: 'mp_roundt' });
    assert(hits.length >= 3, `只命中 ${hits.length} 条`);
    for (const entry of hits) {
      assert(entry.command.includes('mp_roundt'), `离题结果：${entry.command}`);
    }
    return `${hits.length} 条：${hits.map((entry) => entry.command).join(', ')}`;
  });

  await check('搜索可匹配中文描述（合成 descriptionZh 验证回退路径）', async () => {    const sample = commands[0];
    const patched = commands.map((entry) =>
      entry.id === sample.id ? { ...entry, descriptionZh: '中文测试描述：准星颜色' } : entry,
    );
    const hits = filterCommands(patched, { ...EMPTY_FILTERS, query: '中文测试' });
    assertEqual(hits.length, 1, '中文搜索命中数');
    assertEqual(hits[0].command, sample.command, '中文搜索命中命令');
    const missHits = filterCommands(patched, { ...EMPTY_FILTERS, query: '不存在的关键词zzz' });
    assertEqual(missHits.length, 0, '无关关键词应无命中');
    return `中文关键词命中 ${hits[0].command}，无关关键词命中 0 条`;
  });

  await check('搜索可匹配真实中文译文（merge 后的 descriptionZh）', async () => {
    const sample = commands.find((entry) => /[\u4e00-\u9fa5]{4,}/.test(entry.descriptionZh ?? ''));
    if (!sample) {
      return { skipped: true, reason: '当前数据集还没有中文译文（merge 前）' };
    }
    const snippet = /[\u4e00-\u9fa5]{4,}/.exec(sample.descriptionZh)[0].slice(0, 4);
    const hits = filterCommands(commands, { ...EMPTY_FILTERS, query: snippet });
    assert(
      hits.some((entry) => entry.command === sample.command),
      `用中文片段「${snippet}」没有命中 ${sample.command}`,
    );
    for (const entry of hits) {
      const haystack = `${entry.command}${entry.descriptionZh}${entry.descriptionEn}`.toLowerCase();
      assert(haystack.includes(snippet.toLowerCase()), `离题结果：${entry.command}`);
    }
    return `用「${snippet}」命中 ${hits.length} 条，含 ${sample.command}（${sample.descriptionZh.slice(0, 24)}…）`;
  });

  await check('同一维度内多选 = OR（flags: cheat|sv）', async () => {
    const cheatOnly = filterCommands(commands, { ...EMPTY_FILTERS, flags: ['cheat'] });
    const svOnly = filterCommands(commands, { ...EMPTY_FILTERS, flags: ['sv'] });
    const either = filterCommands(commands, { ...EMPTY_FILTERS, flags: ['cheat', 'sv'] });
    assert(either.length >= Math.max(cheatOnly.length, svOnly.length), 'OR 结果不该少于任一单选项');
    assert(either.length <= cheatOnly.length + svOnly.length, 'OR 结果不该超过并集');
    for (const entry of either) {
      assert(entry.flags.includes('cheat') || entry.flags.includes('sv'), `OR 语义错误：${entry.command}`);
    }
    return `cheat=${cheatOnly.length}, sv=${svOnly.length}, cheat|sv=${either.length}`;
  });

  await check('不同维度之间 = AND（关键词 + 标记 + 首字母）', async () => {
    const combined = filterCommands(commands, {
      ...EMPTY_FILTERS,
      query: 'mp_roundt',
      flags: ['sv'],
      sections: ['M'],
    });
    assert(combined.length > 0, 'AND 组合无命中');
    for (const entry of combined) {
      assert(entry.command.includes('mp_roundt'), `关键词未生效：${entry.command}`);
      assert(entry.flags.includes('sv'), `标记未生效：${entry.command}`);
      assertEqual(entry.section, 'M', `${entry.command} 的段落`);
    }
    const keywordOnly = filterCommands(commands, { ...EMPTY_FILTERS, query: 'mp_roundt' });
    assert(combined.length <= keywordOnly.length, 'AND 应进一步收窄结果');
    const narrower = filterCommands(commands, {
      ...EMPTY_FILTERS,
      query: 'mp_roundt',
      flags: ['sv'],
      sections: ['M'],
      defaultValue: 'has',
    });
    assert(narrower.length <= combined.length, '叠加默认值维度后应变窄');
    return `mp_roundt + sv + 段落M = ${combined.length} 条（仅关键词 ${keywordOnly.length} 条），再叠加「有默认值」= ${narrower.length} 条`;
  });

  await check('按首字母段落筛选 A-Z/_ 与总数守恒', async () => {
    const sectionCounts = new Map();
    for (const entry of commands) {
      sectionCounts.set(entry.section, (sectionCounts.get(entry.section) ?? 0) + 1);
    }
    let sum = 0;
    for (const [sectionKey, expected] of sectionCounts) {
      const hits = filterCommands(commands, { ...EMPTY_FILTERS, sections: [sectionKey] });
      assertEqual(hits.length, expected, `段落 ${sectionKey} 命中数`);
      sum += expected;
    }
    assertEqual(sum, EXPECTED_COMMANDS, '各段落总数');
    return `${sectionCounts.size} 个段落：${[...sectionCounts.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`;
  });

  await check('有默认值 / 无默认值筛选互补', async () => {
    const has = filterCommands(commands, { ...EMPTY_FILTERS, defaultValue: 'has' });
    const none = filterCommands(commands, { ...EMPTY_FILTERS, defaultValue: 'none' });
    assertEqual(has.length + none.length, EXPECTED_COMMANDS, '两类之和');
    for (const entry of has) assert(entry.defaultValue !== null, `「有默认值」含 null：${entry.command}`);
    for (const entry of none) assertEqual(entry.defaultValue, null, `「无默认值」含非 null：${entry.command}`);
    return `有默认值 ${has.length} 条，无默认值 ${none.length} 条`;
  });

  await check('空筛选返回全部，hasActiveFilters 反映状态', async () => {
    assertEqual(filterCommands(commands, EMPTY_FILTERS).length, EXPECTED_COMMANDS, '空筛选命中数');
    assertEqual(hasActiveFilters(EMPTY_FILTERS), false, '空筛选 hasActiveFilters');
    assertEqual(hasActiveFilters({ ...EMPTY_FILTERS, query: 'a' }), true, '有关键词 hasActiveFilters');
    assertEqual(hasActiveFilters({ ...EMPTY_FILTERS, flags: ['sv'] }), true, '有标记 hasActiveFilters');
    assertEqual(
      filterCommands(commands, { ...EMPTY_FILTERS, query: '不存在的关键词zzz' }).length,
      0,
      '空结果',
    );
    return '全部 2528 条 / 空结果 0 条';
  });

  // ---------- 4. 复制字符串 ----------
  section('4. 复制字符串拼装（复用前端 app/src/lib/copy.ts 的真实实现）');

  await check('sv_cheats 单条「命令+值」拼装', async () => {
    assertEqual(buildCommandLine('sv_cheats', '1'), 'sv_cheats 1', 'buildCommandLine');
    const entry = commands.find((item) => item.command === 'sv_cheats');
    assert(entry, '数据里没有 sv_cheats');
    assertEqual(
      buildCommandLine(entry.command, entry.defaultValue),
      `sv_cheats ${entry.defaultValue}`,
      '用真实默认值拼装',
    );
    assertEqual(buildCommandLine('sv_cheats', ''), 'sv_cheats', '空值退化为单命令名');
    assertEqual(buildCommandLine('sv_cheats', null), 'sv_cheats', 'null 值退化为单命令名');
    return `sv_cheats 1 / sv_cheats ${entry.defaultValue}（默认值）/ sv_cheats（空值）`;
  });

  await check('mp_roundtime 系列批量复制（每行一条）', async () => {
    const family = commands.filter((item) => item.command.startsWith('mp_roundtime'));
    assert(family.length >= 3, `mp_roundtime 系列只有 ${family.length} 条`);
    const withValues = buildBatchText(family, { includeValues: true });
    const lines = withValues.split('\n');
    assertEqual(lines.length, family.length, '行数');
    for (let i = 0; i < family.length; i += 1) {
      const entry = family[i];
      const expected = entry.defaultValue === null ? entry.command : `${entry.command} ${entry.defaultValue}`;
      assertEqual(lines[i], expected, `第 ${i + 1} 行`);
    }
    const namesOnly = buildBatchText(family, { includeValues: false });
    assertEqual(namesOnly, family.map((item) => item.command).join('\n'), '仅命令名批量文本');
    assert(!namesOnly.includes('  '), '仅命令名文本出现多余空格');
    const cfg = buildCfgFile(family);
    assert(cfg.endsWith('\n'), '.cfg 文本应以换行结尾');
    assertEqual(cfg.split('\n').length, family.length + 1, '.cfg 行数');
    return `${family.length} 行（含值）：${lines.join(' / ')}`;
  });

  await check('defaultValue=cmd 的命令不把 cmd 当成值（+lookatweapon）', async () => {
    const entry = commands.find((item) => item.command === '+lookatweapon');
    assert(entry, '数据里没有 +lookatweapon');
    assertEqual(valueForCommand(entry.defaultValue), '', 'valueForCommand(cmd)');
    assertEqual(buildCommandLine(entry.command, entry.defaultValue), '+lookatweapon', 'cmd 拼接结果');
    assertEqual(valueForCommand(null), '', 'valueForCommand(null)');
    assertEqual(valueForCommand('  1  '), '1', 'valueForCommand 会 trim');
    return "+lookatweapon（默认值 cmd 被忽略）+ valueForCommand(null)===''";
  });

  await check('批量复制含值的行都能作为 .cfg 单行执行', async () => {
    const sample = commands.filter((item) => item.command.startsWith('mp_roundtime'));
    const text = buildBatchText(sample, { includeValues: true });
    for (const line of text.split('\n')) {
      assert(/^\S+( \S.*)?$/.test(line), `非法命令行：${JSON.stringify(line)}`);
      assertEqual(line.trimStart(), line, `行首有空白：${JSON.stringify(line)}`);
    }
    return `${sample.length} 行全部符合「命令 [值]」格式`;
  });

  // ---------- 5. 降级策略 ----------
  section('5. 前端降级策略（descriptionZh 为空 / 部分翻译）');

  let translationState = null;

  await check('当前数据集的中文描述状态与回退预期一致', async () => {
    const total = commands.length;
    const translated = commands.filter((entry) => entry.descriptionZh.trim() !== '').length;
    const withEn = commands.filter((entry) => entry.descriptionEn.trim() !== '').length;
    assertEqual(withEn, dataset.meta.withEnglishDescription, 'meta.withEnglishDescription');
    const metaFilled = dataset.meta.translationStatus?.descriptionZhFilled;
    if (typeof metaFilled === 'number') {
      assertEqual(translated, metaFilled, 'meta.translationStatus.descriptionZhFilled');
    }
    // 有英文描述的条目必须全部有中文（merge 后应为 100%）；没有英文的条目 descriptionZh 为空
    const missingZh = commands.filter(
      (entry) => entry.descriptionEn.trim() !== '' && entry.descriptionZh.trim() === '',
    ).length;
    translationState = { total, translated, withEn, missingZh };
    return `descriptionZh 已填 ${translated}/${withEn} 条有英文描述的命令（总 ${total} 条，${total - withEn} 条源站无描述）；仍缺中文 ${missingZh} 条 -> 未翻译条目回退英文并标注「英文原文」，两者皆空显示「（数据源未提供描述）」`;
  });

  // ---------- 6. 参数占位符 ----------
  section('6. 参数占位符：中文注解 + 复制保持原样');

  const TOKEN_RE = /\{[^{}]*\}|<[^<>]*>|\[[^[\]]*\]/g;
  const tokenCounts = new Map();
  let tokenOccurrences = 0;
  const commandsWithTokens = new Set();
  for (const entry of commands) {
    for (const field of ['descriptionEn', 'descriptionZh']) {
      const text = entry[field] ?? '';
      for (const token of text.match(TOKEN_RE) ?? []) {
        tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
        tokenOccurrences += 1;
        commandsWithTokens.add(entry.command);
      }
    }
  }

  await check('内联的占位符释义表覆盖数据里全部占位符写法', async () => {
    const tableSize = PLACEHOLDER_TOKENS.length;
    assert(tableSize >= 82, `释义表只有 ${tableSize} 条`);
    const uncovered = [...tokenCounts.keys()].filter((token) => !placeholderMeaning(token));
    assert(uncovered.length === 0, `未覆盖：${uncovered.join(', ')}`);
    const bySource = (source) => PLACEHOLDER_TOKENS.filter((entry) => entry.source === source);
    const variants = bySource('variant').map((entry) => entry.token);
    const annotated = tableSize - variants.length;
    return `${tableSize} 条（glossary ${bySource('glossary').length} / derived ${bySource('derived').length} / 译文变体 ${variants.length}），覆盖 ${tokenCounts.size} 种真实写法 / ${tokenOccurrences} 处 / ${commandsWithTokens.size} 条命令；界面注解 ${annotated} 种，译文变体原样显示：${variants.join(' ')}`;
  });

  await check('占位符渲染逐字保真（切片拼接 === 原文）', async () => {
    let checked = 0;
    for (const entry of commands) {
      for (const text of [entry.descriptionEn, entry.descriptionZh]) {
        if (!text) continue;
        const segments = renderPlaceholderSegments(text);
        const rebuilt = segments.map((segment) => segment.text).join('');
        assertEqual(rebuilt, text, `${entry.command} 的文本被改写`);
        checked += 1;
      }
    }
    return `校验了 ${checked} 段描述，逐字一致（含所有反斜杠与空格）`;
  });

  await check('`<t\\|ct>` 的反斜杠是数据、不是脏字符，且被原样保留', async () => {
    const withBackslash = [];
    for (const entry of commands) {
      for (const field of ['command', 'defaultValue', 'descriptionEn', 'descriptionZh']) {
        const value = entry[field];
        if (typeof value === 'string' && value.includes('\\')) withBackslash.push({ entry, field, value });
      }
    }
    assert(withBackslash.length > 0, '数据里没有带反斜杠的字段（预期 bot_kick / bot_kill 的 <t\\|ct>）');
    for (const { entry, field, value } of withBackslash) {
      const segments = renderPlaceholderSegments(value);
      assertEqual(segments.map((s) => s.text).join(''), value, `${entry.command}.${field} 反斜杠被改写`);
      const ph = segments.find((s) => s.kind === 'placeholder' && s.text.includes('\\'));
      if (ph) assert(ph.zh.length > 0, '占位符缺少释义');
      const occurrences = (value.match(/\\/g) ?? []).length;
      assertEqual(value.split('\\').length - 1, occurrences, '反斜杠计数异常');
      assert(value.includes('\\|'), `${entry.command}.${field} 里应保留 \`\\|\``);
    }
    const rows = withBackslash.map((item) => `${item.entry.command}.${item.field}`).join(', ');
    return `${withBackslash.length} 处含反斜杠字段（${rows}），逐字保留且未被转义/清洗`;
  });

  await check('复制路径不改写取值中的占位符与反斜杠', async () => {    const botKick = commands.find((entry) => entry.command === 'bot_kick');
    assert(botKick, '数据里没有 bot_kick');
    const rawValue = '<all> <t\\|ct> <type> <difficulty> <name>';
    assertEqual(buildCommandLine('bot_kick', rawValue), `bot_kick ${rawValue}`, '占位符取值拼接');
    assertEqual(valueForCommand(rawValue), rawValue, 'valueForCommand 未清洗占位符');
    assertEqual(valueForCommand('  <player>  '), '<player>', '只去首尾空白，不动内容');
    const batch = buildBatchText([{ command: 'bot_kick', defaultValue: rawValue }], { includeValues: true });
    assertEqual(batch, `bot_kick ${rawValue}`, '批量复制同样逐字保留');
    assertEqual(
      buildCommandLine('say_team', '[<player name or index>]'),
      'say_team [<player name or index>]',
      '方括号占位符取值拼接',
    );
    return `bot_kick <all> <t\\|ct> <type> <difficulty> <name>（复制后逐字一致，反斜杠保留）`;
  });

  await check('占位符释义表与生成脚本一致（可重复生成）', async () => {
    const generator = resolve(projectRoot, 'app/scripts/inline-parameter-tokens.mjs');
    assert(existsSync(generator), `缺少生成脚本：${generator}`);
    const code = await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [generator, '--check'], {
        cwd: projectRoot,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('exit', (exitCode) => resolvePromise(exitCode));
      child.on('error', () => resolvePromise(-1));
    });
    assertEqual(code, 0, 'node app/scripts/inline-parameter-tokens.mjs --check 退出码');
    return '生成脚本 --check 退出码 0（app/src/lib/placeholders.ts 与 data/translation/parameter-tokens.md 同步）';
  });

  // ---------- 7. 无头浏览器真实渲染 ----------
  section('7. 无头浏览器渲染检查（防白屏）');

  const browser = skipBrowser ? null : findBrowser();
  await check('真实渲染后的 DOM 含命令列表、计数与占位符注解', async () => {
    if (!browser) {
      return { skipped: true, reason: skipBrowser ? '已用 --no-browser 跳过' : '本机未找到 Chrome/Edge' };
    }
    const dom = await dumpRenderedDom(browser, base);
    const text = dom
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ');
    assert(text.includes('CS2 控制台命令与变量查询'), '页面标题未渲染');
    assert(dom.includes('id="root"'), '#root 缺失');
    assert(!/id="root"><\/div>/.test(dom), '#root 为空（白屏）');
    const rows = [...dom.matchAll(/data-command="([^"]+)"/g)].map((match) => match[1]);
    assert(rows.length >= 80, `只渲染出 ${rows.length} 行命令`);
    assert(rows.includes('+lookatweapon'), '首行命令 +lookatweapon 未渲染');
    assert(text.includes('全部 2528 条'), '未渲染「全部 2528 条」计数');
    // 中文状态提示随数据自适应：全未翻译 / 部分翻译 / 全部合并
    const { translated, withEn } = translationState ?? { translated: 0, withEn: 0 };
    if (translated === 0 && withEn > 0) {
      assert(text.includes('中文描述尚未合并'), '未渲染「中文描述尚未合并」提示');
    } else if (translated > 0 && translated < withEn) {
      assert(text.includes('部分翻译'), `未渲染「部分翻译」提示（${translated}/${withEn}）`);
    } else if (translated > 0) {
      assert(text.includes('中文描述已全部合并'), '全部翻译时应提示「中文描述已全部合并」');
      assert(!text.includes('中文描述尚未合并'), '全部翻译后不应再显示未合并提示');
    }
    const untranslatedInFirstChunk = commands
      .slice(0, 80)
      .filter((entry) => entry.descriptionEn.trim() !== '' && entry.descriptionZh.trim() === '').length;
    if (untranslatedInFirstChunk > 0) {
      assert(
        dom.includes('badge badge--untranslated'),
        `首屏有 ${untranslatedInFirstChunk} 条未翻译却没渲染「英文原文」标注`,
      );
    } else if (translated > 0) {
      assert(
        !dom.includes('badge badge--untranslated'),
        '全部有中文时首屏不应出现「英文原文」兜底标注',
      );
    }
    assert(text.includes('（数据源未提供描述）'), '未渲染「数据源未提供描述」占位文案');
    assert(text.includes('复制命令+值'), '未渲染复制按钮');
    assert(dom.includes('参数占位符'), '未渲染参数占位符 tooltip');
    assert(dom.includes('class="ph"'), '未渲染占位符高亮（<abbr class="ph">）');
    assert(text.includes('参数占位符对照表'), '未渲染占位符对照表入口');
    return `${rows.length} 行命令已渲染（首行 ${rows[0]}），计数/降级标注/占位符注解均存在 · 浏览器 ${browser.split('\\').pop()}`;
  });

  await check('真实交互：搜索 / 复制（toast + 剪贴板）/ Esc / 预设筛选 / 批量复制', async () => {
    if (!browser) {
      return { skipped: true, reason: skipBrowser ? '已用 --no-browser 跳过' : '本机未找到 Chrome/Edge' };
    }
    if (typeof WebSocket === 'undefined') {
      return { skipped: true, reason: '当前 Node 没有全局 WebSocket，无法驱动 CDP' };
    }
    try {
      return await runInteractiveChecks(browser, base, commands);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ECONNREFUSED|CDP WebSocket 连接失败|轮询 .* 超时/.test(message)) {
        return { skipped: true, reason: `无法建立 CDP 连接：${message}` };
      }
      throw error;
    }
  });

  // ---------- 8. 构建产物 ----------
  section('8. 构建产物体积');
  await check('dist 产物存在且体积已知', async () => {
    const distIndex = resolve(projectRoot, 'dist/index.html');
    if (!existsSync(distIndex)) return '本次使用 --dev，跳过 dist 检查（pnpm build 后可见）';
    const distDataset = resolve(projectRoot, 'dist/data/commands.json');
    assert(existsSync(distDataset), 'dist/data/commands.json 缺失（preview/静态托管会 404）');
    const parts = ['index.html', 'data/commands.json'].map((name) => {
      const file = resolve(projectRoot, 'dist', name);
      return `${name} ${(statSync(file).size / 1024).toFixed(1)} KB`;
    });
    return parts.join(' · ');
  });

  await check('dist 里的数据与源数据字节一致（防止交付旧的英文副本）', async () => {
    const distDataset = resolve(projectRoot, 'dist/data/commands.json');
    if (!existsSync(distDataset)) {
      return { skipped: true, reason: '本次使用 --dev，未构建 dist' };
    }
    const distBytes = readFileSync(distDataset);
    const localBytes = readFileSync(LOCAL_DATASET);
    const distHash = sha256(distBytes);
    const localHash = sha256(localBytes);
    assertEqual(distBytes.length, localBytes.length, 'dist 数据字节数');
    assertEqual(distHash, localHash, 'dist 数据 sha256');
    const distZh = JSON.parse(distBytes.toString('utf8')).commands.filter(
      (entry) => (entry.descriptionZh ?? '').trim() !== '',
    ).length;
    assert(distZh > 0 || translationState.translated === 0, `dist 数据里没有中文描述（${distZh} 条）`);
    return `dist/data/commands.json sha256=${distHash.slice(0, 16)}… 与 data/commands.json 相同（${distBytes.length} 字节，含中文描述 ${distZh} 条）`;
  });

  // ---------- 汇总 ----------
  const passed = results.filter((item) => item.ok).length;
  const skipped = results.filter((item) => item.skipped).length;
  const failed = results.filter((item) => !item.ok);
  console.log(`\n===== 自测汇总：${passed}/${results.length} 通过${skipped > 0 ? `（含 ${skipped} 项 SKIP）` : ''} =====`);
  console.log(`服务器：${base}`);
  if (failed.length > 0) {
    console.log('失败项：');
    for (const item of failed) console.log(`  - [${item.section}] ${item.name}：${item.detail}`);
  }
  exitCode = failed.length === 0 ? 0 : 1;
} catch (error) {
  console.error('\n[FATAL] 自测脚本无法完成：', error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  stopServer();
}

console.log(`\n退出码：${exitCode}`);
process.exit(exitCode);
