# CS2 控制台命令与变量查询（中文）—— 前端

React 18 + Vite 5 + TypeScript 实现的中文查询前端：2528 条 CS2 控制台命令与变量，
支持搜索、多维筛选、一键复制（单条 / 命令+值 / 批量 .cfg）。

## ⚠️ 部署（必须部署在站点根路径）

构建产物使用**绝对路径**，因此 **`dist/` 必须部署到站点根路径**（如 `https://example.com/`）。
放到子路径（如 `https://example.com/cs2/`）会 **404**：页面框架与数据都取不到。

- `dist/index.html` 里是绝对路径的静态资源：`/assets/index-*.js`、`/assets/index-*.css`（Vite 默认 `base: '/'`）。
- 应用自身用绝对路径取数据：`fetch('/data/commands.json')`，见 `app/src/hooks/useDataset.ts` 的 `DATASET_URL`
  与 `vite.config.ts` 里 `cs2-frozen-dataset` 插件的同名常量。

如需**子路径部署**，要同时改三处（缺一即 404），然后重新 `pnpm build`：

1. `vite.config.ts` 增加 `base: '/cs2/'`（决定 `dist/index.html` 里资源前缀）。
2. `app/src/hooks/useDataset.ts` 的 `DATASET_URL` 改为带前缀的路径，或改成基于 `import.meta.env.BASE_URL`
   （例如 `` `${import.meta.env.BASE_URL}data/commands.json` ``）。
3. `vite.config.ts` 里插件的 `DATASET_URL` 同步改（dev/preview 中间件靠它匹配请求路径），
   并确认 `dist/data/commands.json` 与 `base` 对应的路径一起部署。

本地 `pnpm dev`（:5173）与 `pnpm preview`（:4173）都按根路径服务，无需改动。

## 目录结构

```
index.html                     入口 HTML（Vite root = 仓库根目录）
vite.config.ts                 构建配置 + cs2-frozen-dataset 插件（见下）
tsconfig.json                  TypeScript 配置（strict，noEmit）
app/src/
  main.tsx, App.tsx            应用入口与页面编排
  types.ts                     冻结数据契约的类型定义
  lib/filter.ts                纯函数筛选核心（无 DOM 依赖，Node 端可复用）
  lib/copy.ts                  纯函数命令行拼装（无 DOM 依赖，Node 端可复用）
  lib/clipboard.ts             Clipboard API 封装 + 手动复制降级
  lib/flags.ts                 21 个引擎标记的中文标签/说明 + 预设
  lib/placeholders.ts          82 种参数占位符中文释义（自动生成，勿手改）
  hooks/useDataset.ts          fetch('/data/commands.json') + 结构校验 + 错误提示
  components/                  筛选面板、列表（分块渲染）、占位符渲染、toast、错误边界
app/scripts/smoke-test.mjs     可重复运行的自测脚本（HTTP + 纯函数 + 无头浏览器）
app/scripts/inline-parameter-tokens.mjs  占位符释义表生成器（读写见文件头）
app/evidence/                  最近一次 install / build / smoke 的真实输出
```

## 命令

```bash
# 依赖（pnpm 11；构建脚本白名单见 pnpm-workspace.yaml 的 allowBuilds）
pnpm install

# 开发服务器：http://localhost:5173/
pnpm dev

# 类型检查 + 生产构建（产物在 dist/，同时会把 data/commands.json 复制到 dist/data/）
pnpm build

# 预览构建产物：http://localhost:4173/
pnpm preview

# 自测（默认起 vite preview；--dev 用开发服务器；--no-browser 跳过无头浏览器检查）
pnpm smoke
pnpm smoke:dev
```

## 数据契约（冻结，不得改动）

运行时 `fetch('/data/commands.json')`：

```
{ meta: { source, sourceRetrieved, sourceBuild, generatedAt, commands, withEnglishDescription, uniqueEnglishDescriptions, chunks },
  commands: [ { id, command, defaultValue, flags, descriptionEn, descriptionZh, section } ] }
```

数据由 `tools/prepare-data.mjs` 生成、`tools/merge-translations.mjs` 合并中文，前端只读不写。为了让 dev / preview /
任意静态服务器都在同一 URL 下提供它，`vite.config.ts` 里的 `cs2-frozen-dataset` 插件做两件事：

- **dev**：在 Vite 内部中间件之前挂一个只读中间件，原样回 `data/commands.json` 的字节
  （否则 Vite 的 JSON 插件会把它改写成 `export default {...}` 的 ESM 模块，`JSON.parse` 会失败）。
- **build**：把同一个文件复制到 `dist/data/commands.json`，`pnpm preview` 与静态托管都能直接取到。

**dev 与 build 走的是同一个 `resolveDatasetFile()`，不存在分叉**：优先 `data/commands.json`，
不存在时回退 `app/public/data/commands.json`（二者字节一致；`app/public/` 属于 data-engineering 的写入范围，前端只读）。
两个路径都不存在时中间件返回 500 并在响应体里列出尝试过的路径，`pnpm build` 直接失败，不会静默产出空界面。

交付前请确认 dist 里的数据不是旧副本 —— 自测脚本内置了这道守卫：

```bash
node -e "const{createHash}=require('crypto'),fs=require('fs');const h=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');console.log(h('data/commands.json'),h('dist/data/commands.json'))"
# 两行必须相同；不同说明 dist 是旧的，需要重新 pnpm build
```

`pnpm smoke` 会以 `[PASS] dist 里的数据与源数据字节一致（防止交付旧的英文副本）` 的形式做同样的校验，
并额外 assert `dist/data/commands.json` 里确实含中文描述。

## 功能

- **搜索**：大小写不敏感，匹配命令名 + 中文描述 + 英文描述；多个空格分隔的关键词之间是 AND；输入即时过滤。
- **筛选**：标记多选（21 条白名单，含「仅显示作弊 / 仅服务端 / 仅客户端 / 仅正式版」预设）、
  首字母段落 A-Z/`_`、有/无默认值。**同一维度内多选 = OR，维度之间 = AND**。
- **复制**：点命令名复制命令名；「复制命令+值」用手写/默认值拼 `sv_cheats 1` 这样的单行；
  勾选多行后「批量复制（命令+值）/ 批量复制命令名 / 复制为 .cfg」（每行一条，可直接粘进 .cfg）。
  复制成功弹 toast「已复制」；Clipboard API 不可用（非 HTTPS/localhost）或抛错时，
  自动弹出**手动复制面板**（文本已全选，提示按 Ctrl+C）。
- **键盘**：`Enter` 复制第一条结果，`Esc` 依次关闭面板 → 清空搜索 → 清空全部筛选，`/` 聚焦搜索框。
- **计数与空态**：顶部实时显示「全部 / 筛选结果 X / 2528 条」，无命中时给出友好提示与清空按钮。
- **性能**：筛选结果用 `useMemo` 缓存，列表按 80 条分块渲染（IntersectionObserver 自动追加 + 「显示更多」兜底），
  行组件 `React.memo`，2528 条下滚动与输入都不卡。

## 降级策略（`descriptionZh` 为空 / 部分翻译 / 全部合并）

- 每条命令优先显示 `descriptionZh`；为空时回退显示 `descriptionEn`，并在该条旁边标注「**英文原文**」徽章。
- 顶部横幅三种状态自适应：`0/可翻译` 时「中文描述尚未合并」；`0 < X < 可翻译` 时「部分翻译：X / Y 条有英文原文的命令已有中文描述」；
  全部翻译后显示「中文描述已全部合并：X / Y 条有英文原文的命令均已翻译；另有 Z 条命令源站本身没有提供描述」。
  「可翻译」= `descriptionEn` 非空的条目数（当前 1587/2528，其余 941 条源站无描述）。
- 两种描述都为空时显示「（数据源未提供描述）」，不留空白。
- 判断按条进行，所以 merge 前后、部分合并时界面都正确，无需改代码。

## 参数占位符（82 种 + 4 种译文变体）

描述里的参数占位符（`{entity_name}`、`<player>`、`<mapname>`、`<t\|ct>` 等）在中文译文中**逐字保留英文**
（仅下文记录的 4 种描述性方括号变体例外），因为它们要能直接粘进 `.cfg` / 控制台。前端只做展示层注解：

- 占位符渲染为 `<abbr title="参数占位符 xxx：中文释义（复制时保持原样）">` + 行内小字「〔中文释义〕」，
  可用「显示参数释义」开关切换为仅 tooltip。
- 释义表 `app/src/lib/placeholders.ts` 由 `node app/scripts/inline-parameter-tokens.mjs` 生成：
  释义取自 `data/translation/parameter-tokens.md`，**写法与出现次数取自 `data/commands.json`**
  （markdown 表格里的 `\\|` 是表格转义，数据里是 `\|`；`[<max distance>]` 这类外层方括号写法按子占位符合成释义）。
  每条带 `source` 字段：`glossary`（表格精确对应）/ `derived`（由子占位符合成）/ `variant`（译文中出现的**中文变体**，
  不是占位符，界面原样显示、不加注解）。生成脚本幂等，`--check` 可校验生成结果是否与脚本一致（自测脚本已包含该检查）。
- **复制路径不经过任何占位符处理**：`lib/copy.ts` 只拼命令名与取值，`valueForCommand()` 仅去掉首尾空白，
  不转义也不清洗，所以 `<t\|ct>` 的反斜杠原样保留。自测脚本对此有专门断言（`bot_kick` / `bot_kill` 的
  `descriptionEn` 与 `descriptionZh` 共 4 处）。
- 已知数据现象（**不影响功能，captain 已裁定接受**）：`descriptionZh` 里有 **4 种译文变体、影响 6 条命令**，
  译者在这些（描述性）方括号里改写了英文原文：

  | # | 英文原文 | 中文译文 | 受影响命令 |
  | --- | --- | --- | --- |
  | 1 | `[within 256 units of the player]` | `[玩家 256 单位范围内]` | `cl_ent_text256`、`ent_text256` |
  | 2 | `[near the player]` | `[玩家附近]` | `cl_ent_text_radius`、`ent_text_radius` |
  | 3 | `[inner = …, outer = …]`（半角 `", "`） | 同句，`,` 变全角 `，` | `cl_crosshair_dynamic_maxdist_splitratio` |
  | 4 | `[mod authors use this]` | `［mod 作者使用］`（全角方括号） | `sv_disable_immunity_alpha` |

  裁定理由：① 这些是**描述性修饰语，不是可复制参数**；② **复制串只由「命令名 + 取值」拼成，从不读 `descriptionZh`**
  （`lib/copy.ts` 里没有任何 description 相关引用），并已用真实浏览器剪贴板实测确认复制内容里不会出现方括号中文；
  ③ 数据集在 t7 复核后已冻结，此时改动会使那份验证证据作废 —— 因此保留原样。
  界面上它们按普通文本渲染，不会被误标为占位符：扫描到的 3 种（`source: 'variant'`）与不在扫描范围内的
  `［mod 作者使用］`（全角括号）都不加注解。

## 自测脚本

`app/scripts/smoke-test.mjs`（纯 Node 标准库）会：

1. 真起一个服务器（默认 `vite preview`，`--dev` 用 dev，`--base <url>` 复用已有服务），
   通过 HTTP 校验页面、静态产物、`/data/commands.json` 的 200/内容类型/解析、**服务端字节与本地
   `data/commands.json` 的 sha256 相等**，以及 2528 条与 id/命令名/标记白名单等不变量。
2. 直接 `import` 前端的 `.ts` 纯函数（Node 类型擦除）来验证搜索/筛选语义与复制字符串拼装，
   包括 `sv_cheats`、`mp_roundtime` 系列、`+lookatweapon`（`defaultValue=cmd`）、真实中文译文的搜索命中。
3. 用无头 Chrome/Edge `--dump-dom` 校验真实渲染结果（80 行命令、计数、中文状态横幅、占位符注解，防白屏），
   渲染后的 DOM 存到 `app/evidence/dom-<模式>.html` 供人工复查。
4. 用 DevTools Protocol 驱动真实页面：搜索 → 点「复制命令+值」→ 校验 toast 与 `navigator.clipboard.readText()` →
   改「值」再复制 → `Esc` 清空 → 预设筛选 → 勾选批量复制，全链路断言剪贴板内容。
5. 校验占位符逐字保真（切片拼接 === 原文）、反斜杠保留、释义表与生成脚本一致。
6. 校验 `dist/data/commands.json` 与源数据 sha256 相同且含中文描述（防止交付合并前的旧副本）。

退出码：全部通过（或仅 SKIP）为 0，任一 FAIL 为 1。
无头浏览器 / CDP 不可用时对应项显示 `[SKIP]`（不计为失败），可用 `--no-browser` 显式跳过。
