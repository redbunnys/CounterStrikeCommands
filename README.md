# CS2 控制台命令与变量中文查询（2528 条）

从 Valve 开发者社区维基抓取 **Counter-Strike 2 控制台命令与变量全表（2528 条）**，逐条翻译为简体中文，
并提供一个可**搜索 / 多维筛选 / 勾选后一键复制**到 `.cfg` 的 React 前端。

- 数据：`data/commands.json`（2528 条，1587 条有中文描述），sha256 `c6ce50e8b41567911926e22cff25a4f060befa058debffd4a6ebb4c0160673a1`（821439 字节）
- 前端：React 18 + Vite 5 + TypeScript，纯手写 CSS，无运行时第三方依赖（除 React）
- 工具链：纯 Node 标准库脚本，离线可跑、幂等、自带断言（任一失败即 `exit 1`）

> ⚠️ 抓取的是 **2023-10-02 / build 9832** 的快照（Valve Developer Community 页面标注的版本），
> 命令的默认值与旗标会随游戏更新变化。依赖具体取值前，请以游戏内 `cvarlist` / `help` 输出为准。
> 来源与加工过程详见文末[数据来源说明](#数据来源说明)。

---

## 目录

- [快速开始](#快速开始)
- [功能](#功能)
- [项目结构](#项目结构)
- [数据来源与版本](#数据来源与版本)
- [数据统计](#数据统计)
- [数据来源说明](#数据来源说明)
- [如何重新抓取与重生成数据](#如何重新抓取与重生成数据)
- [前端如何拿到数据](#前端如何拿到数据)
- [已知限制](#已知限制)
- [验证与证据](#验证与证据)
- [未验证项](#未验证项)
- [常见问题](#常见问题)

---

## 快速开始

**环境要求**：Node.js ≥ 20（实测 v26.5.0）、pnpm 11（实测 11.15.1）。

```bash
pnpm install        # 安装依赖
pnpm dev            # 开发服务器  → http://localhost:5173/
pnpm build          # 类型检查 + 生产构建 → dist/（并把数据集复制进 dist/data/）
pnpm preview        # 预览构建产物 → http://localhost:4173/  ⚠️ 需要先 pnpm build
pnpm smoke          # 集成自测：起 preview + 无头浏览器跑 34 项断言
pnpm smoke:dev      # 同上，但起 vite dev（端口 5173）
pnpm typecheck      # 仅类型检查
```

补充说明：

- `pnpm dev` / `pnpm preview` 的端口在 `vite.config.ts` 里分别是 **5173 / 4173**，且 `strictPort: false` —— 端口被占用时会自动顺延，请以终端打印的 `Local:` 地址为准。
- `pnpm smoke` 默认自己起 `vite preview`（4173）。要复用已在运行的服务，用
  `node app/scripts/smoke-test.mjs --base http://127.0.0.1:4173`；只想验数据层可加 `--no-browser`。
- 直接双击 `index.html`（`file://`）**不可用**：浏览器会拦截 `fetch`，请用 dev/preview 服务器。
- **pnpm 11 注意事项**：pnpm 11 不再读取 `package.json` 的 `pnpm` 字段，依赖安装脚本的白名单必须写在
  `pnpm-workspace.yaml`。本仓库已配置好（Vite 依赖的 esbuild 需要放行）：

  ```yaml
  # pnpm-workspace.yaml
  allowBuilds:
    esbuild: true
  ```

  若缺少这段，`pnpm install` 会以 `ERR_PNPM_IGNORED_BUILDS` 退出码 1 结束。

---

## 功能

- **搜索**：大小写不敏感，同时匹配「命令名 + 中文描述 + 英文描述」；空格分隔的多个关键词之间是 AND；输入即时过滤。
- **筛选**：`标记`（21 条引擎 flag 白名单，含「仅作弊 / 仅服务端 / 仅客户端 / 仅正式版」预设）、`首字母段落`（A–Z 与 `_`）、`有/无默认值`。
  **同一维度内多选 = OR，不同维度之间 = AND**。
- **一键复制**：
  - 点命令名 → 复制命令名（如 `sv_cheats`）；
  - 「复制命令+值」→ 拼成可直接粘进 `.cfg` 的单行（如 `sv_cheats false`）；行内「值」可先手工改成自己要的取值；
  - 勾选多条（或「全选当前结果」）→ 「批量复制（命令+值）」「批量复制命令名」「复制为 .cfg」（每行一条，行尾 LF）。
  - 批量复制**只作用于当前筛选结果**。
  - 剪贴板 API 不可用时自动弹出「手动复制面板」（文本已全选，按 Ctrl+C 即可）。
- **快捷键**：`Enter` 复制第一条结果、`Esc` 逐级清空（面板 → 搜索词 → 全部筛选）、`/` 聚焦搜索框。
- **计数与空态**：顶部实时显示「全部 / 筛选结果 X / 2528 条」，命中 0 条时给出提示与「清空全部筛选」按钮。
- **参数释义**：描述里的参数占位符（`{entity_name}`、`<player>`、`<t\|ct>` 等）在译文中**刻意保留英文原样**，
  界面上为它们渲染中文提示（`<abbr title="参数占位符 …：中文释义（复制时保持原样）">` + 行内小字「〔中文释义〕」），
  可用「显示参数释义」开关切换为仅 tooltip。**复制路径完全不经过占位符处理**。
- **性能**：筛选结果 `useMemo` 缓存，列表按 80 条分块渲染（滚动自动追加 + 「显示更多」兜底），行组件 `React.memo`。

---

## 项目结构

```
.
├── index.html                    前端入口（指向 app/src/main.tsx）
├── vite.config.ts                构建配置 + cs2-frozen-dataset 插件（在 /data/commands.json 提供数据集）
├── pnpm-workspace.yaml           pnpm 11 安装脚本白名单（allowBuilds: esbuild）
├── package.json / tsconfig.json
├── app/
│   ├── src/                      React 源码
│   │   ├── App.tsx               应用外壳：搜索栏、筛选面板、列表、批量条、toast
│   │   ├── components/           CommandList / FilterPanel / PlaceholderText / Toast / ErrorBoundary / ParameterTokenGlossary
│   │   ├── hooks/useDataset.ts   取数 + 加载/错误状态
│   │   └── lib/                  filter.ts（筛选语义）、copy.ts（复制拼装）、placeholders.ts（占位符释义表）等纯函数
│   ├── scripts/
│   │   ├── smoke-test.mjs        集成自测（34 项：HTTP/数据/搜索筛选/复制/DOM）
│   │   └── inline-parameter-tokens.mjs  占位符释义表生成器（--check 可校验）
│   ├── public/data/commands.json 数据集副本（与 data/commands.json 字节一致，前端只读）
│   ├── evidence/                 最近一次 install / build / smoke 的真实输出与渲染后的 DOM
│   └── README.md                 前端细节说明（占位符渲染、降级策略、自测清单）
├── data/
│   ├── commands.json             冻结数据集（2528 条，含 descriptionZh）
│   ├── cs2-commands.raw.json     维基 HTML 的解析中间产物（2530 行，含 2 条 N/A 占位行）
│   ├── raw/cs2_wiki.html         抓取的源页面快照（sha256 b6c2013d…731ee2）
│   ├── raw/fetch-meta.json       抓取元数据（URL / 状态码 / 字节数 / 时间）
│   ├── translation/
│   │   ├── README.md             翻译契约（8 条硬性约束、不译清单、流水线顺序）
│   │   ├── glossary.json         术语/flag/取值 对照表
│   │   ├── parameter-tokens.md   82 种参数占位符中文对照表
│   │   ├── chunks/               翻译工作单元（10 个，共 1465 条唯一描述）
│   │   └── out/                  译文产物（chunk-001…010.json）
│   ├── merge-report.json/.txt    合并报告（断言、逐块核对、台账）
│   ├── prepare-report.txt        数据集构建报告
│   ├── verify-dataset.txt        数据校验日志
│   └── verify-bundle.* / t8-*.md / t9-*.md   独立验证与复核证据
├── tools/                        抓取/解析/构建/校验脚本（见「重新抓取与重生成数据」）
└── dist/                         构建产物（dist/data/commands.json 与源字节一致）
```

---

## 数据来源与版本

| 项 | 值 |
| --- | --- |
| 来源页面 | <https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables> |
| 抓取时间 | 2026-10-08T14:45:48Z（HTTP 200，`gated: false`） |
| 源站标注版本 | **October 2, 2023 / build 9832 (revision 8384867)** |
| 源页面快照 | `data/raw/cs2_wiki.html`，sha256 `b6c2013d18cc58450a629d64ca0da5f7f325469b2e0403cbbe0a7d440b731ee2` |
| 响应字节数 | 抓取时响应长度 **379036** 字节；落盘文件 **379154** 字节（见[已知限制](#已知限制)第 9 条） |
| 交付数据集 | `data/commands.json` / `app/public/data/commands.json` / `dist/data/commands.json`，三份字节相同，sha256 `c6ce50e8b41567911926e22cff25a4f060befa058debffd4a6ebb4c0160673a1`，821439 字节 |

处理链路：抓取 HTML → **解析**（Parser 只做结构化，不做翻译）→ **规范化**
（丢弃 2 条空段落 `N/A` 占位行；修复 4 条 wiki 渲染损坏行；flags 过滤到 21 条白名单并保序去重；
`Cvar_list` 段落映射为 `_`）→ **翻译**（1465 条唯一描述，10 个工作单元）→ **合并** → **校验**。

---

## 数据统计

| 指标 | 数值 |
| --- | --- |
| 命令总条数 | **2528**（维基渲染出的 2530 行 − 2 条 `N/A` 占位行） |
| 有英文描述 | **1587** |
| 唯一英文描述 | **1465**（全部翻译为简体中文，覆盖率 100%） |
| 源站本身没有描述 | **941**（`descriptionEn` 为空，因此没有中文描述） |
| 空译文 | 0 |
| 引擎 flag 白名单 | 21 条 |
| 修复的 wiki 损坏行 | 4（`meta.repairedRows`） |
| 登记的源站原文残缺 | 13 条 / 6 类（`meta.sourceDefects`、`data/merge-report.json`） |
| 参数占位符 | 82 种；255 处（口径：唯一描述 + 最左非重叠匹配） |

---

## 数据来源说明

> **数据来源：Valve 官方开发者站点 Valve Developer Community（developer.valvesoftware.com）的公开页面。**
>
> - 抓取页面：
>   <https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables>
> - 抓取时间：**2026-10-08T14:45:48Z**；该页面标注的 CS2 版本为 **2023-10-02 / build 9832 (revision 8384867)**。
> - 数据经过本仓库工具链的**解析与规范化**：结构化提取命令名/默认值/旗标/描述；
>   丢弃 2 条空段落占位行；**修复 4 条页面渲染损坏行**（`meta.repairedRows` 记录了「原始损坏单元格 → 还原值」）；
>   **登记 13 条源站原文自身的残缺**（`meta.sourceDefects`，例如括号不闭合、`Changes's` 所有格错误，译文按要求逐字保留原文形态）。
> - 中文描述为**二次加工内容**（机器辅助翻译 + 人工校对口径），由本项目生成，可能与游戏内实际用词不一致。
> - **命令与变量会随游戏更新变化**：默认值、可用性、旗标都可能与当前 CS2 版本不同。
>   在把任何取值写进配置、脚本或服务器设置之前，**请以游戏内 `cvarlist` / `help`（或 `sv_cheats` 相关的实际行为）输出为准**。
> - 本项目为第三方工具，与 Valve 公司无隶属或背书关系；Counter-Strike、Steam 等为其各自权利人的商标。

---

## 如何重新抓取与重生成数据

工具链**顺序不可颠倒**，除第 1 步外全部离线可跑：

```bash
# 1. 抓取源页面（需要网络）→ data/raw/cs2_wiki.html + data/raw/fetch-meta.json
node tools/fetch-valve-wiki.mjs

# 2. 解析 HTML → data/cs2-commands.raw.json（2530 行，含 2 条 N/A 占位行）
node tools/parse-commands.mjs

# 3. 冻结数据集与翻译工作单元 → data/commands.json、data/translation/{glossary.json,README.md,chunks/}
#    ⚠️ 该脚本新增了「防误删译文」守卫（见下方说明），日常重建请加 --preserve-translations
node tools/prepare-data.mjs --preserve-translations

# 4. 翻译：按 data/translation/README.md 的契约，把 chunks/chunk-001…010.json 逐条译成
#    data/translation/out/chunk-001…010.json（这一步由翻译流程产出，格式见该 README）

# 5. 合并译文 → data/commands.json（填充 descriptionZh）+ app/public/data/commands.json
node tools/merge-translations.mjs

# 6. 数据校验（含 HTML ↔ dataset 全量逐行比对、坏行/邻行审计、台账一致性、占位符保真）
node tools/verify-dataset.mjs

# 7.（可选）坏行防护的负向/回归自测：全部在临时目录里跑，不写仓库
node tools/guard-selftest.mjs

# 8.（可选）端到端独立验证：构建 + preview + 真实浏览器驱动搜索/筛选/批量复制
node tools/verify-bundle.mjs

# 9. 重新构建前端（把数据集复制进 dist/data/commands.json）
pnpm build
```

### `prepare-data.mjs` 的「防误删译文」守卫（重要）

该脚本的设计就是把 `descriptionZh` 重置为 `""`（先冻结数据、再由 merge 填中文）。因此**在已经合并过译文的仓库里直接运行它会销毁 1587 条已翻译、已验证的中文**。现在安全的一侧是默认行为：

```bash
node tools/prepare-data.mjs                        # 检测到已有译文 → 拒绝运行并 exit 1，什么都不写
node tools/prepare-data.mjs --preserve-translations  # 保留现有译文重建（幂等：产物与冻结数据集字节一致）
node tools/prepare-data.mjs --reset-translations     # 真的清空译文（之后必须再跑 merge-translations.mjs）
node tools/prepare-data.mjs --help                   # 用法
```

### 其他要点

- **第 3 步重置译文**：若用了 `--reset-translations`，之后**必须再跑一次 `merge-translations.mjs`**，否则前端会退回显示英文。
- 上述脚本都是**幂等**的：输入不变时重复执行，产物字节一致；`chunks/` 采用 write-if-changed，重跑不会打断翻译进度。
- `merge-translations.mjs` 内建 1579 条断言、`prepare-data.mjs` 内建 2581 条断言、`verify-dataset.mjs` 94 项检查，
  **任一条失败即 `exit 1`**，不会静默产出坏数据。
- 翻译契约（硬性约束、不译清单、占位符规则）见 `data/translation/README.md`；占位符中文对照表见
  `data/translation/parameter-tokens.md`。
- 前端占位符释义表 `app/src/lib/placeholders.ts` 是**生成物**，改完 `parameter-tokens.md` 或数据后请重新生成：
  `pnpm gen:tokens`（或 `node app/scripts/inline-parameter-tokens.mjs`；`--check` 只校验不写）。

---

## 前端如何拿到数据

前端在运行时请求 `/data/commands.json`（`app/src/hooks/useDataset.ts`），由 `vite.config.ts` 的
`cs2-frozen-dataset` 插件提供，dev 与 build **走同一个文件解析函数，不存在分叉**：

| 模式 | 数据来源 |
| --- | --- |
| `pnpm dev` | 插件中间件按原始字节返回 `data/commands.json`（优先）/ `app/public/data/commands.json`（回退） |
| `pnpm build` | 把同一个文件原样复制到 `dist/data/commands.json` |
| `pnpm preview` / 静态托管 | `dist/data/commands.json` |

两个候选文件都不存在时：dev 返回 HTTP 500 并在响应体里列出候选路径，build 直接失败 —— **不会静默产出空白界面**。
`app/scripts/smoke-test.mjs` 内置守卫，会断言 `dist/data/commands.json` 与 `data/commands.json` 的 **sha256 相等**
且确实含中文描述，防止交付合并前的旧英文副本。

---

## 已知限制

1. **数据版本时效**：源站快照为 **2023-10-02 / build 9832 (revision 8384867)**，**并非当前 CS2 版本**。
   游戏更新后命令与变量可能新增、删除或改变默认值；本仓库不做实时同步（重新抓取见上一节）。
2. **4 条 wiki 渲染损坏行**：`tv_broadcast_url`、`tv_broadcast_url1`、`cl_promoted_settings_acknowledged`、
   `sv_mapvetopickvote_phase_duration` 在源站 HTML 里本身就是坏的 —— wiki 渲染器吃掉了 Default Value 里的
   分隔符，把剩余字段用 `&#160;:` 串进了后一列。它们的**默认值无法从 HTML 反推**，因此用显式枚举表还原，
   并在构建时逐条断言；`meta.repairedRows` 完整记录了「原始损坏单元格 → 还原后的 defaultValue/flags/description」。
   修复未影响任何相邻行（8 个邻行已逐字段比对）。
3. **13 条源站原文残缺**（`meta.sourceDefects`，同时收录在 `data/merge-report.json`）：
   例如 `miny miny`（单词重复）、`default..`（标点重复）、`both)`（括号不闭合）、`Changes's`（所有格错误）等。
   这是**维基原文自身的问题**，不是解析或翻译缺陷；译文按要求**逐字保留原文形态**，不做修正。
   完整清单：索引 `70, 223, 281, 292, 455, 661, 805, 864, 898, 908, 1008, 1143, 1232`。
4. **941 条命令在源站就没有描述**，因此没有中文描述；界面显示「（数据源未提供描述）」，不会留空白。
5. **参数占位符刻意保留英文**（82 种，见 `data/translation/parameter-tokens.md`）：它们是可直接粘贴进 `.cfg` 的
   技术参数（`{entity_name}`、`<mapname>`、`<t\|ct>` 等），改译会破坏可复制性。中文可读性由前端的中文提示承担。
   该文档中「255 处」的计数口径是**唯一描述 + 最左非重叠匹配**（因此 `<{entity_name} / {class_name} / …>`
   算 1 个复合占位符）；若按「每个 token 每出现一次都算」的朴素口径则是 271 处（唯一描述）/ 405 处（按命令）。
6. **已登记并接受的译文变体偏差（4 种译文变体，影响 6 条命令；编号 122 / 184 / 187 / 1185）**：
   - (a) 编号 184 `[within 256 units of the player]` → `[玩家 256 单位范围内]`（`cl_ent_text256`、`ent_text256`）
   - (b) 编号 187 `[near the player]` → `[玩家附近]`（`cl_ent_text_radius`、`ent_text_radius`）
   - (c) 编号 122 `cl_crosshair_dynamic_maxdist_splitratio` 描述里 `[inner = …, outer = …]` 的半角逗号改成全角 `，`
   - (d) 编号 1185 `sv_disable_immunity_alpha` 的 `[mod authors use this]` → `［mod 作者使用］`（半角方括号也变成了全角）
   编号口径：该英文描述在 **1465 条唯一描述**中的索引，与 `data/translation/chunks/` 的 index 空间一致；
   `app/README.md` 用的是同一套编号（其 184 / 187 与本表一致）。本条目与 `app/README.md`「**4 种译文变体、影响 6 条命令**」
   的表述保持完全一致。
   统一理由：这些是**描述性修饰语**，不是可复制参数；复制串仅由「命令名 + 取值」拼成、从不读 `descriptionZh`
   （已用真实浏览器剪贴板实测确认复制内容里不会出现方括号中文占位符），因此**无功能影响**；
   且数据集在验证（t7）完成后已冻结，此时改动会使既有验证证据作废。
   `app/src/lib/placeholders.ts` 的释义表把它们标为 `source: 'variant'`，界面按普通文本显示、不会误标为占位符。
7. **源站退化/截断描述 7 例**（**非**拼写类残缺，不属于第 3 条的台账）：
   索引 `20`（`ct> <type> <difficulty> <name> …` 开头被截断）、`67`（`all> | <not_bomber> | <t> | <ct>`）、
   `241`（`1`）、`517`（`off >.`）、`672`（`T> <N>, e.g., mp_modify ct -1`）、`1085`（`test`）、`1265`（`Party!!`）。
   译文按「标识符原样 + 中文释义」处理（如 `bot_stop` 的 `<all> | <not_bomber> | <t> | <ct>` 保留原 token
   并补注可选值释义，**不补全**原文缺失的开头），界面与复制功能均正常；此处登记仅为避免后续读者误判为解析错误。
8. **部署路径限制**：构建产物使用**绝对路径**（`dist/index.html` 里的 `/assets/…`，以及前端请求的
   `/data/commands.json`），因此**必须部署在站点根路径**；部署到子路径（如 GitHub Pages 项目站点）会 404。
   若确需子路径，请自行设置 Vite `base` 并让取数改用 `import.meta.env.BASE_URL` 拼 URL。
9. **字节数口径**：`data/raw/fetch-meta.json` 的 `bytes: 379036` 是抓取时的 **HTTP 响应长度**，
   而落盘文件 `data/raw/cs2_wiki.html` 为 **379154 字节**（按 UTF-8 重新编码后写入）。
   两者差异属预期；sha256 链完好（`meta.sourceSha256` = 文件实际 sha256 = `b6c2013d…731ee2`）。
10. **【环境问题，不计入交付缺陷】** 本会话的联网搜索功能不可用：
    `HTTP 401 Authentication Fails, Your api key: 123 is invalid`，端点 `https://api.deepseek.com/anthropic/v1/messages`。
    这是**会话/插件配置问题**（搜索端点与 chat 端点配置分离），与数据抓取、翻译、前端交付物无关；
    数据抓取使用的是独立的 `tools/fetch-valve-wiki.mjs`，快照已带 sha256 溯源。
11. **后续改进项（不改变交付数据）**：`tools/` 已包含一轮加固：`prepare-data.mjs` 增加与判据 A/B 正交的
    「错位防护」+「防误删译文」守卫；`verify-dataset.mjs` 增加 HTML↔dataset 全量逐行比对（现为 94/94 通过）；
    新增 `tools/guard-selftest.mjs` 做负向/回归自测。**这些改动不改变交付数据集** —— 已用隔离副本复跑验证：
    `prepare-data --preserve-translations` → `merge-translations` 的产物与冻结数据集**字节一致**
    （sha256 仍为 `c6ce50e8…673a1`）。注意 `data/translation/README.md` 第 11 节的示例命令写于本次加固之前，
    其中 `node tools/prepare-data.mjs` 应当按上文补上 `--preserve-translations`（或 `--reset-translations`）。
12. **`tools/guard-selftest.mjs` 与新的 prepare-data CLI 尚未对齐（工具自测失败，不影响交付物本身；已登记为 t13）**：
    该自测在隔离副本里直接调用 `prepare-data.mjs`（不带参数），而副本中包含已合并译文的数据集，
    因此会命中「防误删译文」守卫并 `exit 1`，导致 14 个场景中 4 个报 FAIL（`RESULT: 10/14`、`VERDICT: FAIL`）。
    根因是 **CLI 守卫晚于该自测落地**（两者均在 t10 引入），并非数据或守卫逻辑有问题：手工按
    `--preserve-translations` 调用时，baseline / roundtrip 场景全部正常（实测：prepare + merge 产物与冻结数据集字节一致）。
    修复方式：把该自测的场景改为传 `--preserve-translations`（或在注入坏行的场景中同样传该 flag），
    详见 `data/t9-integration-acceptance.md` 的 T1。
13. **未验证项**见下一节；`dist/` 是构建产物，不要手工编辑。

---

## 验证与证据

| 证据 | 内容 |
| --- | --- |
| `data/prepare-report.txt` | 数据集构建报告（2581/2581 断言通过） |
| `data/merge-report.json` / `.txt` | 译文合并报告（1579 条断言、逐块 key 核对、源站缺陷台账） |
| `data/verify-dataset.txt` | 数据校验日志（**94/94 通过**，含 HTML↔dataset 全量逐行比对、台账双向复扫） |
| `data/verify-bundle.txt` / `.json` | **独立验证器**（`tools/verify-bundle.mjs`）逐条断言与结构化证据 |
| `data/verify-bundle-findings.md` | 独立验证发现清单（F1–F5） |
| `data/t8-quality-gate-review.md` | 质量复核门判定（**pass**，0 blocker / 0 high） |
| `data/t9-integration-acceptance.md` | 端到端集成验收记录（构建/预览/浏览器全链路实测） |
| `app/evidence/` | 前端最近一次 install / build / smoke 的真实输出与渲染后的 DOM |

独立验证（`node tools/verify-bundle.mjs`）在最终产物上覆盖：数据集三份副本字节一致性与分发副本 sha256、
2528 条与源站 HTML 的**全量逐行比对**（2530 行 × 5 字段）、4 个修复行与 8 个邻行、
1587/1465 翻译覆盖率复算、flags 白名单、82 种占位符中英文逐字一致、13 条源站残缺台账复扫
（与台账双向 ⊆）、以及**真实浏览器**里的搜索 / 筛选 / 勾选 / 一键复制链路。
最新一次全量运行：**120 / 120 通过，`RESULT: ALL CHECKS PASS`（exit 0）**。

> 关于 `N3`：该负向用例在 t7 时用于**证明坏行检测存在盲区**（当时的断言是「该形态会被静默放过」）。
> t10 用与判据 A/B 正交的「错位防护」封死该盲区后，`N3` 已改为**反向回归用例**：断言该反例
> **现在必须被拒绝**（`exit≠0` 且失败信息点名 `zzz_verify_gap_probe`），同时断言旧判据 A/B 依然命中不了它、
> 且拒绝不是误触发「防误删译文」守卫 —— 于是它从「证明有漏洞」变成「证明漏洞已封死」。
> 因此验证器不再留红（117 → 120 项断言，全部通过）。

---

## 未验证项

诚实列出本次**没有**验证的内容（其余功能均有实测证据）：

1. **像素级视觉/样式回归**：未做截图比对；只验证了 DOM 结构与文本内容正确、无白屏。
2. **系统级剪贴板写入**：用 `navigator.clipboard.writeText` 打桩捕获了**传给剪贴板 API 的真实字符串**
   （并逐字节比对 `copy.ts` 的输出），但没有验证操作系统剪贴板里最终落下的内容，也没有测 `navigator.clipboard`
   完全缺失时的「手动复制面板」人工操作路径（仅确认该分支存在且会打开面板）。
3. **游戏内核对**：未与真实 CS2 客户端的 `cvarlist` / `help` 输出逐条比对（环境中无游戏客户端）。
4. **子路径部署**：仅做静态分析（绝对路径会 404），未真正部署到子路径环境实测。
5. **非 Windows 平台**：所有实测都在 Windows + Chrome 154 上完成，未在 macOS/Linux 或 Firefox/Safari 上验证。
6. **实时数据新鲜度**：未校验 2023-10-02 快照与当前 CS2 版本的差异（见「已知限制」第 1 条）。

---

## 常见问题

**Q：界面里全是英文描述？**
构建产物里的数据是旧的英文副本。请 `pnpm build`（插件会把 `data/commands.json` 复制到 `dist/data/`），
或用 `node -e` 比较两份文件的 sha256（详见 `app/README.md`）。

**Q：`pnpm preview` 打不开 / 报错找不到 dist？**
`preview` 只服务构建产物，先跑 `pnpm build`。

**Q：`pnpm install` 失败并提示 `ERR_PNPM_IGNORED_BUILDS`？**
pnpm 11 需要在 `pnpm-workspace.yaml` 里放行 esbuild 的安装脚本（见[快速开始](#快速开始)）。

**Q：改完 `data/translation/parameter-tokens.md` 后前端提示没变？**
释义表是生成物，重新执行 `pnpm gen:tokens`。

**Q：端口被占用？**
`dev`/`preview` 都设了 `strictPort: false`，会自动顺延；以终端打印的地址为准。
