# t7 独立验证报告（verifier）

- 验证对象：cs2-commands-zh 全链路产物（`data/commands.json` / `app/public/data/commands.json` / `dist/data/commands.json` / `data/translation/*` / 前端 dist）
- 验证器：`tools/verify-bundle.mjs`（本次独立编写：纯 Node 标准库、无外网；HTML 解析、坏行判据、邻居比对、占位符抽取、负向测试均为重新实现，未 import 任何 data-engineer 的解析/校验脚本）
- 结论：**117 / 117 断言通过，退出码 0**；未验证项 0；无 blocker/high 级问题；3 个 low + 2 个 info 级发现（见下）

## 1. 真实运行记录

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `node tools/verify-bundle.mjs` | exit 0，`通过 117 / 117；失败 0；未验证 0`，`RESULT: ALL CHECKS PASS` |
| 2 | `node tools/verify-bundle.mjs --skip-frontend --skip-negative` | exit 0，78/78（快速回归口径） |
| 3 | `node tools/verify-bundle.mjs --harness-only` | exit 0，浏览器 harness 独立调试入口，回传 27 项键值 |

日志：`data/verify-bundle.txt`（逐条断言与实测输出）、`data/verify-bundle.json`（结构化证据：抽样、坏行、邻居、占位符、负向测试、浏览器回传）。

环境：node v26.5.0；pnpm 11（`pnpm.CMD`）；vite 5.4.11；Google Chrome 154.0.8037.98（headless=new，`--dump-dom` + `--virtual-time-budget`）。

## 2. 关键独立复算数字（全部与契约一致）

| 项 | 实测 |
| --- | --- |
| commands | 2528（HTML 数据行 2530 − 2 条 N/A 占位行） |
| 有英文描述 / 唯一英文描述 / 无英文描述 | 1587 / 1465 / 941（独立复算，非读 meta） |
| descriptionZh 已填 / 空译文 | 1587 / 0 |
| 含 CJK 比例 | 100.00%（1587/1587） |
| 同一英文描述 → 同一译文 | 一致（无错位） |
| flags 在白名单内 | 100%（unknownFlagTokens=0） |
| 4 个修复行取值 | 与契约逐字节相同 |
| HTML ↔ dataset 全量比对 | 2530 行 × 5 字段，**0 处不一致** |
| 坏行集合（HTML 判据） | 4 行，与 `meta.repairedRows` 集合完全一致 |
| 8 个邻行 | 全部逐字段一致（含互为邻居的两个坏行） |
| `{}`/`<>` 占位符 | 82 种（与 md 一致），中英文集合完全相同，0 丢失 0 新增 |
| `<t\|ct>` 反斜杠 | EN 2 处 / ZH 2 处（全库 `\|` EN=2、ZH=2），未被擦除 |
| 源站缺陷台账 | 13 条，6 类可独立判定的复算结果与 `meta.sourceDefects` 全部一致，且与 HTML 原文逐字一致 |
| 三份数据集副本 | 字节完全相同，sha256 `c6ce50e8…673a1`（821439 B），dist 副本已含 1587 条中文 |

## 3. 前端实测（S8，33/33）

- `pnpm build`：exit 0；日志含 `[cs2-dataset] 已复制数据集 data/commands.json -> dist/data/commands.json`；构建后 dist 副本仍与源字节相同。
- `vite preview`（真实产物，`--host 127.0.0.1`）：`GET /data/commands.json` 200 + `application/json`，sha256 与本地源相同；index.html 引用打包产物。
- 真实浏览器（Chrome headless）内驱动构建产物（同源 iframe harness；已断言 harness 服务与 preview 服务的 JS 字节相同），真实点击搜索框 / 筛选 chip / 复制按钮，并对 `navigator.clipboard.writeText` 打桩抓取真实字符串：
  - 初始「全部 2528 条」，首屏 80 行分块渲染；
  - 搜索 `sv_cheats` → 6 条（setang/setang_exact/setpos/setpos_exact/setpos_player/sv_cheats），`SV_CHEATS` 大小写不敏感同样 6 条；`mp_roundt` → 3 条；中文 `定义服务` → 1 条（CS_WarnFriendlyDamageInterval）；
  - 点击「作弊」→ 1248 条且 `aria-pressed=true`；再点「首字母 M」→ 44 条（跨维度 AND）；
  - 「无默认值」→ 2 条（hostname/name）；
  - 剪贴板真实内容：`复制命令+值` → `sv_cheats false`；`仅命令` → `sv_cheats`；勾选后全选当前结果 → 6 行 `命令+值`；批量命令名 → 6 行命令名；行内值改为 0 后 → `sv_cheats 0`；与真实 `app/src/lib/copy.ts` 的输出逐字节相同（同时与我的独立重写交叉验证）。
- 未验证项：无。（仅轮询/截图式的视觉回归未做，不属于本任务的判定项。）

## 4. 问题清单

### F1 [low] 3 处方括号占位符内容被意译（captain 已裁定接受，本次独立复核确认影响面为零）

- 位置：`cl_crosshair_dynamic_maxdist_splitratio`（`[inner = …, outer = …]` 的 `, ` → `，`）、`cl_ent_text256`/`ent_text256`（`[within 256 units of the player]` → `[玩家 256 单位范围内]`）、`cl_ent_text_radius`/`ent_text_radius`（`[near the player]` → `[玩家附近]`）。
- 复现：`node tools/verify-bundle.mjs` → S12「方括号内容被意译」清单（`data/verify-bundle.json` → `details.bracketDeviations`）。
- 影响面复核（支持 captain 的论断）：全库只有 `sv_mapvetopickvote_phase_duration` 一条命令的 **defaultValue** 含方括号，其描述无该变体；且复制逻辑 `app/src/lib/copy.ts` 只由「命令名 + 取值」拼装，从不读取 `descriptionZh`（浏览器实测 5 个剪贴板字符串中均无方括号中文占位符）。**用户剪贴板不可能出现被翻译的占位符** → 无功能影响。
- 备注：`{}` / `<>` 两类占位符（386 处，70 种）100% 逐字保留，未受影响。

### F2 [low] 第 4 处方括号占位符意译未被登记：`sv_disable_immunity_alpha`，且括号被换成全角

- 原文/译文：
  - EN: `If set, clients won't slam the player model render settings each frame for immunity [mod authors use this]`
  - ZH: `设置后，客户端不会为了免疫而每帧反复覆盖玩家模型渲染设置［mod 作者使用］`
- 差异点：(a) 占位符内容被意译（同 F1 类型）；(b) **半角 `[...]` 被替换成全角 `［...］`**，属于字符级改动，不是 F1 那种「内容意译但括号形状保持」。
- 复现：`node -e "const d=require('./data/commands.json');console.log(d.commands.find(c=>c.command==='sv_disable_immunity_alpha'))"`。
- captain 的裁定清单只覆盖索引 184 / 187 / crosshair 三处，**未包含本条**；因此我把「方括号被意译的条目集合」写死为已知 6 条（4 种英文原文）的断言：再出现新变体会让校验失败，避免遗漏继续无声扩大。
- 影响：仅展示层，复制串不受影响（该命令 defaultValue 为 `0`，不含方括号）→ 无功能影响；建议登记进已知变体清单或修回逐字保留（二选一，不必返工）。

### F3 [low] 两级坏行检测存在共同盲区（构造性反例，**不是当前数据缺陷**）

- 现行防护（已阅读源码并逐条引用）：
  - `tools/prepare-data.mjs:500` `isRunOnRow = runOn.seps.length > 0 && (badFlags.length > 0 || runOnFlags.length > 0)`，未登记即 `check(!!repair, 'run-on row … is enumerated in WIKI_ROW_REPAIRS')` 失败；配套 `unhandledRunOnRows.length === 0`、`repairedRows.length === Object.keys(WIKI_ROW_REPAIRS).length`。
  - `tools/verify-dataset.mjs:371` `WIKI_NBSP_COLON`（HTML 级判据 A）与 `:415` 判据 B（Flags 列出现非白名单 token），末了断言 `html corrupt-row set === meta.repairedRows set`。
- 隔离负向测试（全部在 `os.tmpdir()` 副本内执行，真实数据未被触碰）：
  - **N1 撤销修复**（把 `tv_broadcast_url` 改成 `http://localhost:9999`）→ `exit=1`，`FAILED: repaired default value of tv_broadcast_url (expected "http://localhost:8080", got "http://localhost:9999")`。
  - **N2 注入未登记坏行**（`zzz_verify_injected_runon`，`&#160;:` 形态）→ `exit=1`，`FAILED: run-on row zzz_verify_injected_runon is enumerated in WIKI_ROW_REPAIRS` + `FAILED: every corrupt run-on row has an enumerated repair`。→ **「再现同类坏行会直接失败」成立**。
  - **N3 覆盖边界探针**：构造「**不使用 &#160; 标记** + Flags 列**全为白名单** + 描述里 run-on 段不含白名单 flag」的形态（输入 `defaultValue:"cl"`、`flags:["sv"]`、`description:"x] : Some description."`，隔离副本里同步把 `EXPECTED_COMMANDS` 调成 2529 以走到检测环节）→ prepare-data **exit=0 静默接受**，产出 `{command:"zzz_verify_gap_probe", defaultValue:"cl", flags:["sv"], descriptionEn:"x] : Some description."}`；按源码逐字复算：prepare 判据命中=false、HTML 判据 A=false、判据 B=false（`details.negativeTests[N3].silentGap=true`）。
- 结论：当前 4 个坏行（always `&#160;:` 形态）**不可能**被静默放过；残余风险只存在于「将来出现一种既不用 nbsp 标记、又恰好让 Flags 列全部落在白名单内、且描述里 run-on 段不含 flag 的新损坏形态」。因为损坏来自 wiki 模板渲染、标记来自模板本身，该形态概率低；但若要彻底封死，建议加一条独立判据（例如「Flags 列内容与其相邻列拼接后能构成 flag 白名单、但 defaultValue 本身是 flag 名」或「HTML 单元格数与模板参数数不匹配」）。本次未修任何代码，仅登记。

### F4 [info] `parameter-tokens.md` 的「255 处」是特定计数口径，容易被误读

- md 声明的 82 种与实测 82 种完全一致；但「255 处」= 在**唯一描述集合**上做 `[\[{]([^{}\[\]<>]*)[\]}]|<([^<>]*)>` 的**最左非重叠匹配**（因此 `<{entity_name} / {class_name} / {entity_index} / {no argument = …}>` 这种组算 1 个复合 token，组内 4 个 token 不再各算一次）。
- 我按该口径复算 **255/255 精确吻合**（逐 token 比对 0 不符）。若按「每个 token 每出现一次都算」的朴素口径则是 **271 处（唯一描述）/ 405 处（按命令）**。
- 建议：在 md 里补一句口径说明，避免后续核对者拿朴素口径对不上 255 而误判为数据缺陷。

### F5 [info] `verify-dataset.mjs` 没有「HTML ↔ dataset 全量文本」比对，建议补作回归护栏

- 现状：HTML 级校验只覆盖坏行集合、坏行还原值、8 个邻行与 flags 来源；其余 2520 行的 `descriptionEn` 以 `data/cs2-commands.raw.json`（自身解析产物）为参照，无法发现解析器对**非坏行**的系统性文本破坏。
- 我的独立全量比对（2530 行 × command/defaultValue/flags/descriptionEn/section）为 **0 处不一致**，故当前无实际缺陷；建议把这条全量比对加进 `verify-dataset.mjs`。

### 非缺陷记录（避免误判为缺陷）

- 13 条形缺（`meta.sourceDefects`）：[70][223][281][292][455][661][805][864][898][908][1008][1143][1232]，逐条与 HTML 原文逐字一致，6 类可独立判定的类型复算全部吻合 → **源站缺陷**，非翻译缺陷。
- 9 条「原文退化为标识符/取值」的条目按 captain 裁决补了中文释义（否则不含 CJK 不合格）：`log`/`cl_test_list_entities`/`test_list_entities`/`menuselect`/`viewmodel_offset_x|y|z`/`bot_stop`/`cl_radar_rotate`（长度比 1.5–5.0），属**已获准的释义性补充**。
- 198 条英文句末有句点、中文不加「。」：中文标点风格决策，非漏译（最短译文长度比 0.167，全库无整句漏译痕迹）。
- 56 个保留英文缩写（HUD/GOTV/SFM…）与 941 条源站无描述：预期行为。

## 5. 翻译质量抽查（item 7）

- 随机 40 条（seed=20261008，可复现，清单见 `data/verify-bundle.txt` S7 段）：逐条人工判读 **40/40 忠实**（无漏译、无误译、无凭空添加），占位符与标识符逐字保留（含 `bot_kill <t\|ct>` 的反斜杠）。
- 唯一风格观察（不构成缺陷）：`weapon_accuracy_nospread` "Disable weapon inaccuracy spread" → 「禁用武器不精准散布」，语义正确但「不精准散布」略拗口，建议「禁用武器散布」。
- 全库风险扫描：最小长度比 0.167、无与英文完全相同的译文、无缺 CJK 的译文、无整句漏译。
