# t8 质量复核门报告（verifier）

**判定：`verdict = pass`** —— 0 个 blocker、0 个 high；4 个 low + 1 个 medium，全部是**文档完整性类**问题（不影响数据正确性与前端功能），逐条给出所需修复（见 §8）。

复核声明：本人为独立验证者。本报告中的「实测」要么来自 t7 已在 `tools/verify-bundle.mjs` 跑出并留档的 117/117（`data/verify-bundle.txt` / `.json`），要么来自 **t8 本轮新做的独立复核**（§0）。不采信任何 agent 的自述结论；`meta.sourceDefects` 内的 13 条索引在本报告中**一律不判为翻译缺陷**。

---

## 0. t8 本轮新做的独立复核

| # | 检查项 | 方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 源站缺陷台账自洽 | 从 `data/commands.json` 读 `meta.sourceDefects`，独立统计 count / entries / detectors 命中数 | count=13、entries=13、detectors 8 条命中数之和=13（`[3,4,1,2,1,2,0,0]`）三者一致 | 本轮 node 复算输出 |
| 2 | merge-report 是否原样收录台账 | `JSON.stringify(meta.entries) === JSON.stringify(mergeReport.sourceDefects.entries)` + 5 字段检查 | 深度相等；13 条均含 `index/descriptionEn/type/typeZh/detail` | 同上 |
| 3 | **全量缺陷复扫**（1465 条唯一描述 × 台账 8 条规则） | 自写检测器逐条扫描，与台账索引做**双向集合比对** | my=`[70,223,281,292,455,661,805,864,898,908,1008,1143,1232]`，ledger 完全相同；`extra=[]`、`missing=[]`；逐规则命中数与台账声明**逐条相等** | §5 表 |
| 4 | 真残渣扫描 | 正则扫 `&#\d+;` / `&amp;` / `&lt;` / `&gt;` / `\u00a0` / TAB / `[[` / `]]` / `<br>` / 闭合标签 | **0 处** | 同上 |
| 5 | 前端三场景真实浏览器实测 | 临时目录内复制 `dist`，自建同源服务 + 无头 Chrome `--dump-dom` 驱动真实页面（不改仓库文件） | 占位符中文提示 ✓、空描述降级 ✓、500 错误态 ✓（详见 §3） | `%TEMP%\t8ui-*`（一次性） |
| 6 | 退化/截断描述探测 | 独立启发式扫描「非句子片段」 | 7 例，均属**另一类**源站现象（台账 6 类未覆盖），translator 已按裁决处理 | §5 末段 |
| 7 | 环境问题复现 | 直接调用联网搜索 | `HTTP 401 … Your api key: 123 is invalid`（endpoint `https://api.deepseek.com/anthropic/v1/messages`）→ 复现成功 | §7 |

---

## 1. 原始需求是否被满足（逐条）

| 需求 | 判定 | 证据 |
| --- | --- | --- |
| 从指定 Valve 维基页获取命令 | **满足** | `data/raw/fetch-meta.json`：`target = finalUrl = https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables`，`status=200`、`gated=false`、`bytes=379036`、`fetchedAt=2026-10-08T14:45:48Z`；HTML 的 `<title>` 与 `wgPageName=List_of_Counter-Strike_2_console_commands_and_variables` 一致；解析出 2530 行数据行 → 丢弃 2 条 `N/A` 占位行 → **2528 条** |
| 逐条翻译成简体中文 | **满足** | 有英文描述的命令 **1587/1587** 都有中文（空译文 0、含 CJK 100.00%）；**1465** 条唯一描述 100% 覆盖；随机 40 条人工判读 **40/40 忠实**（无漏译/误译/凭空添加）；全库最小长度比 0.167（无整句漏译） |
| React 前端 | **满足** | React 18 + Vite 5 + TypeScript（`app/src/App.tsx` 等）；`pnpm build` exit 0；`dist/` 产物可被真实浏览器渲染（首屏 80 行分块渲染） |
| 能筛选相关命令 | **满足** | 真实浏览器实测：搜索 `sv_cheats`=6、`SV_CHEATS`=6（大小写不敏感）、`mp_roundt`=3、中文「定义服务」=1（`CS_WarnFriendlyDamageInterval`）；「作弊」标记=1248 且 `aria-pressed=true`；再点「首字母 M」=44（**维度内 OR / 维度间 AND**）；「无默认值」=2（hostname/name） |
| 筛选后一键复制 | **满足** | 真实浏览器点击复制并抓取 `navigator.clipboard.writeText` 的实际字符串：`"sv_cheats false"`、`"sv_cheats"`、勾选后「全选当前结果」批量=6 行 `命令+值`、行内改值后 `"sv_cheats 0"`；与真实 `app/src/lib/copy.ts` 输出逐字节一致；批量复制只作用于**当前筛选结果**（`App.tsx` 的 `selectedInView`） |

---

## 2. 数据可信度

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 2528 条是否与源站一致 | **一致** | 自写 HTML 解析器全量比对 2530 行 × 5 字段（command/defaultValue/flags/descriptionEn/section）= **0 处不一致**；HTML 无重复 command；dataset 无源站不存在的命令 |
| 4 个已知缺陷行是否真的修复 | **是** | `tv_broadcast_url`/`tv_broadcast_url1` = `http://localhost:8080`；`cl_promoted_settings_acknowledged` = `1696196680965`；`sv_mapvetopickvote_phase_duration` = `[1 \| 5][2 \| 15][3:20][4:10][5:10][6:5]`；且 `wikiCells` 与 HTML 原始损坏单元格逐字一致、还原式结构自洽、**8 个邻行零污染**、互为邻居的两个坏行都识别；HTML 判据再枚举得 4 行，与 `meta.repairedRows` 集合完全相同 |
| 覆盖率 | **1587 / 1465 / 941** | 三个数字均由我独立复算（不读 meta），且与 `meta` 声明一致；`meta.flagFrequency`、`meta.defaultValue*`、`meta.translationStatus` 亦全部复算通过 |
| 翻译质量抽查 | **通过** | 40 条随机对照 40/40 忠实；唯一风格观察 `weapon_accuracy_nospread`「不精准散布」略拗口（按非缺陷处理） |
| 副本一致性 | **三副本字节相同** | `data/commands.json` / `app/public/data/commands.json` / `dist/data/commands.json` 同为 sha256 `c6ce50e8…673a1`、821439 字节（构建后复验，不是旧英文副本） |

---

## 3. 前端可用性（t8 新增实测）

| 项 | 结论 | 实测 |
| --- | --- | --- |
| 构建是否通过 | **通过（t8 亲自复跑）** | `pnpm build` exit 0、7.85s、43 modules；产物 `dist/assets/index-BYtbf0tz.js` / `index-fcKai-3j.css` 与 t6/t7 同名同内容；构建日志 `[cs2-dataset] 已复制数据集 … -> dist/data/commands.json (821439 字节)`；构建后三副本 sha256 全等 `c6ce50e8…673a1` |
| 筛选与复制是否真的工作 | **工作** | 见 §1 的浏览器实测（搜索 / 标记 / 首字母 / 默认值 + 单条与批量复制、行内改值、剪贴板字符串逐字节校验） |
| 空描述降级是否合理 | **合理** | 用**打补丁的 dist 副本**（临时目录内清空 2 条 `descriptionZh`）实测：该条回退显示英文原文并出现「**英文原文**」徽章（`.badge--untranslated`）；顶部横幅变为「**部分翻译：1585 / 1587** 条有英文原文的命令已有中文描述…」；`adsp_debug` 这类两描述皆空的命令显示「（数据源未提供描述）」，不留空白 |
| 错误状态是否友好 | **友好** | 让 `/data/commands.json` 返回 500 后实测：渲染 `role="alert"` 的「**数据加载失败**」卡片，回显 `HTTP 500 Internal Server Error` 与响应体，给出 3 条可操作排查提示（prepare-data 生成、dev/build 数据路径、查 Network），并有「重新加载」按钮；不会白屏 |
| 占位符是否渲染中文提示 | **渲染** | `ent_text` 行实测：4 个 `<abbr title="参数占位符 {entity_name}：实体名称（复制时保持原样，可直接粘进 .cfg）">` + 4 处行内小字「〔实体名称〕〔实体类名〕〔实体编号〕…」；关闭「显示参数释义」开关后**行内提示消失（4→0）、tooltip 保留**；译文变体 `［mod 作者使用］` 以纯文本渲染、`abbr=0`，**未被误标为占位符** |

---

## 4. 【必查】源站缺陷台账核对

- `meta.sourceDefects.count = 13`、`entries.length = 13`、8 条 detectors 命中数之和 `3+4+1+2+1+2+0+0 = 13` —— **三者一致**。
- 索引与队长清单逐条一致：`[70][223][281][292][455][661][805][864][898][908][1008][1143][1232]`；`byType` 6 类计数与 detectors 对应。
- **merge-report 原样收录**：`data/merge-report.json` 的 `sourceDefects.entries` 与 `meta.sourceDefects.entries` **JSON 深度相等**，13 条均含 `index / descriptionEn / type / typeZh / detail` 五项。（`merge-report.txt` 是运行日志，不含台账正文，台账在 JSON 中，符合「原样收录」要求。）
- 每条形缺条目的描述文本与 `data/raw/cs2_wiki.html` 原文**逐字一致**（源站造假确认），且 6 类可独立判定的残缺（括号配对/括号内空格/所有格/单词重复/标点重复/句末缺空格）我的复算结果与台账声明**全部吻合**。
- **本报告不把这 13 条判为翻译缺陷**：translator 逐字保留原文残缺形态是正确行为。

---

## 5. 【必查】无未登记的源站缺陷（全量 1465 条独立复扫）

| 台账规则 | 我的复算命中数 | 台账声明 | 我的索引 |
| --- | --- | --- | --- |
| unbalanced-bracket | 3 | 3 | 661, 805, 908 |
| spacing-inside-parens | 4 | 4 | 281, 864, 898, 1232 |
| possessive-s | 1 | 1 | 1008 |
| duplicate-word | 2 | 2 | 70, 292 |
| duplicate-punctuation | 2 | 2 | 223, 455 |
| missing-space-after-sentence | 1 | 1 | 1143 |
| double-space | 0 | 0 | — |
| unbalanced-double-quote | 0 | 0 | — |

- 并集 **双向 ⊆**：`mine ⊆ ledger = true`，`ledger ⊆ mine = true`，`extra = []`，`missing = []` → **复扫结果 = 台账，无未登记缺陷，通过**。
- 真残渣（HTML 实体 / `&amp;` / `&lt;` / nbsp / TAB / wiki 标记 `[[` `]]` / 残留标签）= **0 处**。
- 另有两类「台账 6 类之外」的源站现象，**判为非缺陷**并说明理由：
  1. **退化/截断描述** 7 例：`[20]` `ct> <type> …`、`[67]` `all> | <not_bomber> | <t> | <ct>`、`[517]` `off >.`、`[672]` `T> <N>, e.g., mp_modify ct -1`、`[241]` `1`、`[1085]` `test`、`[1265]` `Party!!`。这不是拼写类残缺，而是源站该行描述本身被截断/退化为片段；translator 按 `data/translation/README.md` 与队长裁决「标识符原样 + 中文释义」处理，界面显示正常、复制串不受影响 → 非缺陷，仅建议在交付说明的「已知数据现象」里登记这一类（见 R6）。
  2. **强调性重复 `!!`** 6 例：`[339]-[343]` `(Debug!!)`、`[1265]` `Party!!`。台账对 duplicate-punctuation 的定义明确为「`..`，不含省略号与 C++ `::`」，`!!` 属源作者的强调写法，译文如实保留（t3 报告已声明）→ 非缺陷。我的第一版扫描器把 `!!` 也算作标点重复（8 vs 2），收敛到台账口径后完全一致，此处如实记录口径差异。

---

## 6. 已知限制的披露核对

> 说明：下表反映 **t8 复核当时的快照**。其中 R1、R2 已在后续 t9/t11 中修复并经复核，本表已就地更新为最终状态。

| 限制 | 披露位置 | 结论 |
| --- | --- | --- |
| 源站为 2023-10-02 / build 9832 / revision 8384867，**不是当前 CS2 版本** | 原先仅 `data/commands.json.meta.sourceRetrieved|sourceBuild` 与前端页脚（`App.tsx:342-357` 渲染「维基页面版本 / 游戏构建」）；**已由 t9 补入根 `README.md`**（§数据来源与版本、§数据来源说明）与 `app/README.md` | 原先为缺口 → **R1（medium）已修复 ✓** |
| 1465 条唯一描述按风格保留英文缩写（HUD/NPC/FPS/GOTV/HLTV/demo/tick…） | `data/translation/README.md` §6「专有名词不译清单·技术缩写」逐条列表 | 已披露 ✓ |
| 4 个坏行的 wiki 源数据在 Command/Default 列不完整，默认值由被挤入后续单元格的文本还原，`meta.repairedRows` 有记录 | `data/translation/README.md` §9「数据溯源与已知修复」+ `meta.repairedRows`（含 `wikiCells`→`restored`→`why`） | 已披露 ✓ |
| 941 条命令源站本就没有描述（`descriptionEn` 为空） | `app/README.md:96`「其余 941 条源站无描述」；界面横幅也会说明「另有 Z 条命令源站本身没有提供描述」 | 已披露 ✓ |
| 参数占位符刻意保留英文（82 种 / 255 处），可读性由前端 parameter-tokens 中文提示承担 | `app/README.md` §「参数占位符（82 种 + 4 种译文变体）」；`data/translation/parameter-tokens.md` 规则 1-4；浏览器实测提示确实渲染 | 已披露 ✓（计数原偏旧，**R2 已由 t11 修正为 4 种**） |

---

## 7. 环境问题（如实记录，不计入交付缺陷）

联网搜索不可用，**本轮已复现**：

```
Error: DeepSeek API error (HTTP 401): Authentication Fails, Your api key: 123 is invalid (request_id: …)
The web search request used endpoint "https://api.deepseek.com/anthropic/v1/messages"
```

这是**会话配置问题**（api key / search endpoint 配置错误），与数据抓取（`data/raw/cs2_wiki.html` 系本次会话前已抓取并带 sha256 溯源）、翻译与前端交付物**无关**。按队长要求：**必须写进交付说明**（本报告即为记录之一；不构成 findings）。

---

## 8. Findings（结构化）

> 说明：「状态」列为后续补记（append-only），反映各项的最终收口情况；findings 原文保持不变。

| id | 严重级别 | 问题 | 所需修复 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| **R1** | **medium** | 「源站为 2023-10-02 / build 9832，非当前 CS2 版本」这条限制**没有任何文字披露**：只存在于 `meta` 字段与前端页脚两个数字里，读者不会得知「数据是 2023 年的快照、可能与当前 CS2 版本不一致」。发布说明（交付说明）目前尚不存在，该项无人承接。 | 在交付说明中明确写出：`sourceRetrieved=October 2, 2023`、`sourceBuild=9832 (revision 8384867)`，并提示「命令/变量的可用性与默认值可能已随 CS2 版本变化」；建议同时在 `app/README.md` 顶部补一句同样的提示。**属文档缺口，不影响数据正确性与功能，不阻塞交付**。 | `data/commands.json`（meta）、`app/README.md`（建议新增）、交付说明（待产出） | **已修复**（t9：根 `README.md` §数据来源与版本 / §数据来源说明，`app/README.md` 亦已补） |
| **R2** | low | 译文变体计数偏旧：文档与前端释义表都写「3 处/3 种」，实测有 **4 种英文原文（6 条命令）** 的中文写法与英文不一致 —— 漏登的是 `sv_disable_immunity_alpha` 的 `[mod authors use this]` → `［mod 作者使用］`（队长已裁定为「已接受偏差」，本轮不修数据）。 | 把该处并入「已登记并接受的偏差」清单，并把文案从「3 种/3 处」改为「4 种」；`placeholders.ts` 的 `variant` 表同步补一条（`source: 'variant'`，界面行为不变）。 | `app/README.md:100`、`app/README.md:115-117`、`app/src/lib/placeholders.ts:11`（variant 表在 :33/:56/:110） | **已修复**（t11：计数统一为 4 种 / 6 条命令；生成脚本注释模板同步，`--check` exit 0） |
| **R3** | low | 抓取元数据与落盘文件字节数不一致：`fetch-meta.json.bytes=379036`，而 `data/raw/cs2_wiki.html` 实际 **379154** 字节。（sha256 链完好：`meta.sourceSha256` = 文件 sha256 = `b6c2013d…731ee2`，说明只是「HTTP 响应字节数」与「UTF-8 重编码后落盘字节数」两个口径混用。） | 在 `fetch-meta.json` 里注明 `bytes` 为 HTTP 响应字节数、落盘为 UTF-8 重编码后的 379154 字节（或补一个 `bytesOnDisk` 字段）。 | `data/raw/fetch-meta.json` | **已披露**（t9：交付说明 §数据来源说明 注明两个口径） |
| **R4** | low | 部署路径限制未披露：`dist/index.html` 的资源引用是绝对路径（`/assets/index-*.js`），且数据请求写死 `'/data/commands.json'` —— 部署到**子路径**（如 GitHub Pages 项目站点）会 404。当前 `vite.config.ts` 未设 `base`。 | 交付说明注明「需部署在站点根路径，或用 `vite preview`/静态服务器挂在根上」；若确需子路径，设置 `vite base` 并让 `useDataset` 用 `import.meta.env.BASE_URL` 拼 URL（属增强，非本次必需）。 | `app/src/hooks/useDataset.ts:5`、`vite.config.ts:112-129`、`dist/index.html` | **已披露**（t9 交付说明；t11 在 `app/README.md` 增 `## ⚠️ 部署（必须部署在站点根路径）` 章节） |
| **R5** | low（建议） | 「退化/截断描述」这一类源站现象（7 例，见 §5）不在 `meta.sourceDefects` 的 6 类台账内，两处 README 也未提及，只有翻译任务交接记录与我的 t7 清单里写到。它们**不是缺陷**，但缺一份登记会让后续读者把 `off >.`、`all> \| <not_bomber>…` 这类片段误当成解析错误。 | 在 `data/translation/README.md` 的「已知修复/已知现象」或交付说明里，补一小节列出这类退化描述及其处理方式（标识符原样 + 中文释义）。 | `data/translation/README.md` §9/§10（建议新增条目） | **已披露**（t9 交付说明登记 7 例：索引 20/67/241/517/672/1085/1265） |

**非缺陷记录（明确不得计为问题）**：`meta.sourceDefects` 的 13 条索引（源站原文残缺，translator 逐字保留正确）；F1/F2 的 4 种方括号译文变体（队长已裁定为可接受偏差；复制串只由命令名+取值拼成，实测不进剪贴板）；F3 检测盲区与 F5 全量比对护栏（已指派 t10，且 t10 不改动交付数据，不影响本次判定）；`weapon_accuracy_nospread` 措辞；`!!` 强调写法；941 条无描述；56 个保留英文缩写。

---

## 9. 判定

- blocker / high 级未解决问题：**0 / 0**。
- 全部 7 项复核范围均已完成且以实测证据支撑；无「未验证」项被当作通过。
- **verdict = pass**：本次交付（数据集 + 中文翻译 + React 前端）可交付；R1–R5 建议在发布前顺带补进交付说明，不阻塞发布。

---

## 10. 附录：t8 本轮实际运行的命令与输出摘要

| 命令 | 输出摘要 |
| --- | --- |
| `pnpm build` | `EXIT=0`，`✓ 43 modules transformed`，`✓ built in 7.85s`，`已复制数据集 … (821439 字节)`；`data = dist = app/public = c6ce50e8b41567911926e22cff25a4f060befa058debffd4a6ebb4c0160673a1` |
| `node %TEMP%\t8a.mjs`（台账/merge-report 核对） | `count = 13`、`entries = 13`、`detectors = 8 hits = [3,4,1,2,1,2,0,0] sum = 13`、`entries deep-equal: true`、`five fields present: true` |
| `node %TEMP%\t8scan2.mjs`（全量缺陷复扫） | 8 条规则逐条 `my = ledger`；`union mine = ledger = [70,223,281,292,455,661,805,864,898,908,1008,1143,1232]`；`mine ⊆ ledger ? true`、`ledger ⊆ mine ? true`、`extra = []`、`missing = []`；`real residue hits = 0`；退化候选 7 例 |
| `node %TEMP%\t8ui.mjs`（前端三场景，无头 Chrome） | 场景 A：`A_abbr_count=4`、`A_hint_count=4`、`A_abbr_title=参数占位符 {entity_name}：实体名称（复制时保持原样，可直接粘进 .cfg）`、`A_hint_after_off=0`、`A_variant_abbr=0`；场景 B：`B_badge_en=1`、`B_notice_0=部分翻译：1585 / 1587 …`、`B_empty_text=（数据源未提供描述）`；场景 C：`数据加载失败=true`、`state-card--error=true`、`排查提示=true`、`重新加载=true`、`role="alert"=true` |
| `web_search`（环境复现） | `Error: DeepSeek API error (HTTP 401): Authentication Fails, Your api key: 123 is invalid` @ `https://api.deepseek.com/anthropic/v1/messages` |

所有临时脚本与打补丁的 dist 副本都在 `%TEMP%` 内，仓库文件未被修改（唯一写入是 `pnpm build` 正常重建 `dist/`，以及本报告文件）。
