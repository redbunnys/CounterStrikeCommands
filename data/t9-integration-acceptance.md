# t9 端到端集成验收报告（verifier）

- 验收对象：**最终交付物**（数据集 / 中文翻译 / React 前端 / 工具链 / 交付说明）
- 交付说明：仓库根目录 **`README.md`**（本次新建）
- 结论：全链路可用；**交付数据未改变**（仍为 `c6ce50e8…673a1` / 821439 字节）；发现 2 个工具/文档一致性问题（T1、T2），均不影响交付物本身
- 环境：Windows；Node v26.5.0；pnpm 11.15.1；Vite 5.4.11；Google Chrome 154.0.8037.98（headless）

---

## 1. 端到端实测记录（真实命令与输出）

### 1.1 `pnpm install`

```
$ pnpm install
Already up to date
Done in 73ms using pnpm v11.15.1
EXIT=0
```

### 1.2 `pnpm build`（重新构建）

```
$ pnpm build
✓ 43 modules transformed.
dist/index.html                   0.58 kB │ gzip:  0.48 kB
dist/assets/index-fcKai-3j.css   11.72 kB │ gzip:  3.03 kB
dist/assets/index-BYtbf0tz.js   173.68 kB │ gzip: 58.13 kB
✓ built in 8.28s
[plugin cs2-frozen-dataset] [cs2-dataset] 已复制数据集 …\data\commands.json -> …\dist\data\commands.json (802.2 KB, 821439 字节)
BUILD_EXIT=0 elapsed=11.5s
```

**构建产物数据副本（第 2 项必查）**：

| 文件 | 字节数 | sha256 |
| --- | --- | --- |
| `data/commands.json` | 821439 | `c6ce50e8b41567911926e22cff25a4f060befa058debffd4a6ebb4c0160673a1` |
| `app/public/data/commands.json` | 821439 | `c6ce50e8b41567911926e22cff25a4f060befa058debffd4a6ebb4c0160673a1` |
| **`dist/data/commands.json`（构建产物）** | **821439** | **`c6ce50e8b41567911926e22cff25a4f060befa058debffd4a6ebb4c0160673a1`** |

- **三者 sha256 完全相等**，且等于契约值 `c6ce50e8…673a1`；**不是**旧的英文副本（`723311` 字节 / `db0ab471…`）。
- 构建产物内含 **1587 条中文描述 / 2528 条命令**。
- 该 98 KB 差值正是中文译文；若交付旧副本，前端会显示全英文描述 —— 该失败模式在 t8 已用打补丁数据集复现过：
  一旦某条 `descriptionZh` 为空，界面立刻回退英文并打出「英文原文」徽章 + 「部分翻译」横幅，因此**肉眼可辨**。

### 1.3 真实服务 + 真实浏览器全链路（搜索 → 筛选 → 多选 → 一键复制）

`node tools/verify-bundle.mjs`（独立验证器）在最终产物上跑完整链路，`S8` 段落全部通过：

```
$ node tools/verify-bundle.mjs
  [PASS] pnpm build 退出码 === 0  :: exit=0
  [PASS] vite preview 服务可访问（真实产物）  :: ➜  Local: http://127.0.0.1:4391/
  [PASS] preview GET /data/commands.json 返回 200 + JSON  :: 200 application/json; charset=utf-8
  [PASS] preview 提供的数据集与本地 data/commands.json 字节完全相同（含 1587 条中文）
  [PASS] harness 服务提供的 JS 与 preview 服务同字节（同源驱动不影响保真度）
  [PASS] 初始文案为「全部 2528 条」 / 首屏按 80 条分块渲染
  [PASS] 浏览器搜索 "sv_cheats" 命中 6 条 :: setang,setang_exact,setpos,setpos_exact,setpos_player,sv_cheats
  [PASS] 浏览器搜索 "SV_CHEATS" 命中 6 条            ← 大小写不敏感
  [PASS] 浏览器搜索 "定义服务" 命中 1 条 :: CS_WarnFriendlyDamageInterval   ← 中文译文可搜
  [PASS] 浏览器搜索 "mp_roundt" 命中 3 条 :: mp_roundtime,mp_roundtime_defuse,mp_roundtime_hostage
  [PASS] 浏览器点击「作弊」标记筛选命中 1248 条
  [PASS] 浏览器再点「首字母 M」= 跨维度 AND，命中 44 条 (M 单维=299)
  [PASS] 浏览器点「复制命令+值」写出的字符串 === "sv_cheats false"
  [PASS] 浏览器点「仅命令」写出的字符串 === "sv_cheats"
  [PASS] 浏览器勾选后「全选当前结果」再批量复制（命令+值）=== 6 行真实拼装
         got="setang\nsetang_exact\nsetpos\nsetpos_exact\nsetpos_player\nsv_cheats false"
  [PASS] 浏览器批量复制命令名 === 结果集的命令名 LF 拼接
  [PASS] 浏览器把行内「值」改成 0 后复制 === "sv_cheats 0"
```

> 说明：剪贴板内容通过 `navigator.clipboard.writeText` 打桩抓取，并与真实 `app/src/lib/copy.ts` 的输出**逐字节比对**。
> 最近一次全量运行是 **116/117**，唯一失败项是验证器 t7 时期的负向测试 `N3` 期望值过期（见 §4 T1 的背景）。

### 1.4 前端中文渲染抽查（第 3 项）

`node %TEMP%\t9check.mjs`（自建同源服务 + 无头 Chrome 驱动真实 DOM）：

```
count_initial   = 全部 2528 条
header_total    = 2528 条命令 1587 条已有中文 2528 条命中
mp_roundtime    : 筛选结果 3 / 2528 条 | ZH=每回合的分钟数。            | 默认值：3 | 标记=服务端,不可设为默认,可复制,正式版
sv_cheats       : 筛选结果 6 / 2528 条 | ZH=允许在服务器上使用作弊        | 默认值：false | 标记=不可设为默认,可复制,正式版
cl_showfps      : 筛选结果 1 / 2528 条 | ZH=在屏幕顶部显示帧率计（1 = 帧率，2 = 平滑帧率，3 = 服务器毫秒，4 = 显示帧率并记录到文件） | 默认值：0 | 标记=客户端,正式版
```

- 顶部计数确认 **2528 条**、**1587 条已有中文**；
- 三条抽查命令的中文描述、默认值、旗标中文标签均正确渲染；
- `data/commands.json` 与 `app/public/data/commands.json` 字节一致（§1.2 表）。

### 1.5 20 条命令与源 HTML 对齐核对（第 4 项）

自写 HTML 解析器（独立于 `tools/`）从 `data/raw/cs2_wiki.html` 重新提取，与 `data/commands.json` 逐字段比对：

```
HTML 数据行 2530（其中 N/A 占位 2），dataset 2528 条
mp_roundtime                      default="3"        flags=[sv,nf,rep,release]                    OK  zh=有
sv_cheats                         default="false"    flags=[nf,rep,release]                       OK  zh=有
cl_showfps                        default="0"        flags=[cl,release]                           OK  zh=有
tv_broadcast_url                  default="http://localhost:8080"        flags=[release]          OK  zh=有  (修复行)
tv_broadcast_url1                 default="http://localhost:8080"        flags=[release]          OK  zh=有  (修复行)
cl_promoted_settings_acknowledged default="1696196680965"                flags=[cl,a]             OK  zh=（源站无描述）(修复行)
sv_mapvetopickvote_phase_duration default="[1 | 5][2 | 15][3:20][4:10][5:10][6:5]" flags=[sv,release] OK zh=有 (修复行)
bot_kick                          default="cmd"      flags=[sv,release]                           OK  zh=有
setpos_player                     default="cmd"      flags=[sv,cheat]                             OK  zh=有
weapon_accuracy_nospread          default="false"    flags=[sv,cl,rep,release]                    OK  zh=有
hostname                          default=null       flags=[release]                              OK  zh=有
name                              default=null       flags=[a,per_user]                           OK  zh=（源站无描述）
_record                           default="cmd"      flags=[norecord,release]                     OK  zh=有
+lookatweapon                     default="cmd"      flags=[cl,release]                           OK  zh=（源站无描述）
adsp_debug                        default="0"        flags=[a]                                    OK  zh=（源站无描述）
changelevel                       default="cmd"      flags=[release]                              OK  zh=有
map                               default="cmd"      flags=[release,vconsole_fuzzy,vconsole_set_focus] OK zh=有
ent_text                          default="cmd"      flags=[sv,cheat,vconsole_fuzzy]              OK  zh=有
r_drawworld                       default="true"     flags=[cheat]                                OK  zh=有
sv_disable_immunity_alpha         default="false"    flags=[sv,cl,rep,release]                    OK  zh=有
20 条对齐核对：ALL MATCH
```

抽查同时覆盖了 4 个修复行、2 个 `defaultValue=null`、1 个退化描述行（`cl_showfps` 的括号内空格属源站缺陷 [281]）与
2 个「普通空格 + 冒号」的散文行（`changelevel` / `map`，**不是**坏行）。三条命令的中英文对照示例：

| 命令 | EN | ZH |
| --- | --- | --- |
| `mp_roundtime` | How many minutes each round takes. | 每回合的分钟数。 |
| `sv_cheats` | Allow cheats on server | 允许在服务器上使用作弊 |
| `cl_showfps` | Draw fps meter at top of screen (1 = fps, 2 = smooth fps, 3 = server MS, 4 = Show FPS and Log to file ) | 在屏幕顶部显示帧率计（1 = 帧率，2 = 平滑帧率，3 = 服务器毫秒，4 = 显示帧率并记录到文件） |
| `bot_kick` | bot_kick \<all\> \<t\\|ct\> … | bot_kick \<all\> \<t\\|ct\> … - 踢出符合给定条件的某个机器人或所有机器人 |

---

## 2. 交付说明（README.md）覆盖情况

`README.md`（仓库根）已按 t9 要求与队长补充要求覆盖：

| 要求 | 章节 |
| --- | --- |
| 项目结构 | §项目结构 |
| 安装与运行（dev 5173 / preview 4173 / smoke / smoke:dev）+ pnpm 11 的 `allowBuilds` | §快速开始 |
| 重新抓取与重生成数据（`fetch-valve-wiki → parse-commands → prepare-data → 翻译 → merge-translations → verify-dataset → pnpm build`） | §如何重新抓取与重生成数据 |
| 数据来源与版本（2023-10-02 / build 9832）| §数据来源与版本 |
| 数据统计（2528 / 1587 / 1465 / 941） | §数据统计 |
| **数据免责声明**（非 Valve 官方、来源 URL、抓取时间与版本、工具链规范化含 4 行修复与 13 条登记、以游戏内 `cvarlist`/`help` 为准） | §数据免责声明 |
| 已知限制 6+ 项 | §已知限制 |
| 部署路径限制（R4）/ 字节数口径（R3）/ 退化描述登记（R5）/ 4 处已接受变体（R2） | §已知限制 6–9、7 |
| 环境问题（搜索 401，不计交付缺陷） | §已知限制 10 |
| 未验证项 | §未验证项 |
| t10 后续改进项说明 | §已知限制 11 |

---

## 3. t10 加固落地后的复核（不改交付数据）

`tools/` 在 t8 之后发生了改动（mtime 23:44–23:45）：`prepare-data.mjs` 增加「错位防护」与「防误删译文」守卫、
`verify-dataset.mjs` 增加 HTML↔dataset 全量比对、新增 `guard-selftest.mjs`。本轮在 **`%TEMP%` 隔离副本**上复核：

| 复核项 | 结果 |
| --- | --- |
| 真实 raw → `prepare-data --preserve-translations` | exit 0；产物与冻结数据集**字节一致**（`c6ce50e8…673a1`） |
| 紧接 `merge-translations.mjs` | exit 0；`data/commands.json` 与 `app/public/data/commands.json` 仍与冻结产物字节一致 |
| 不传参数运行 `prepare-data` | exit 1 并拒绝执行（`REFUSING TO RUN — this would silently destroy merged translations`），**数据未被改写** |
| 伪造「无 nbsp 标记 + Flags 列全白名单」错位行（t7 的 F3 反例） | exit 1，`FAILED: no misaligned row (bare engine-flag token as Default Value / value duplicated into the Flags cell): hostname(…)` → **盲区已被正交判据封死** |
| `data/verify-dataset.txt`（t10 运行留档） | `RESULT: 94/94 checks passed` / `VERDICT: PASS`（含 F5 全量比对与台账双向复扫） |

---

## 4. Findings（本报告只记录，不修改他人代码）

| id | 严重级别 | 问题 | 所需修复 | 文件:行 |
| --- | --- | --- | --- | --- |
| **T1** | medium | `tools/guard-selftest.mjs` 与新的 `prepare-data.mjs` CLI 未对齐：它在隔离副本（含已合并译文的数据集）里**不带参数**调用 `prepare-data.mjs`，命中「防误删译文」守卫后 `exit 1`，导致 14 个场景中 4 个 FAIL（`baseline: prepare-data exits 0`、`nbsp-new-row: names the row`、`probe-bareflag: names the probe row`、`roundtrip`），输出 `RESULT: 10/14` + `VERDICT: FAIL — the guard is vacuous or over-eager`，会让人误判防护体系失效。根因是 CLI 守卫晚于该自测落地（两者同属 t10）。**交付数据与守卫逻辑本身没有问题**：手工按 `--preserve-translations` 调用时 baseline/roundtrip 全部正常，且「不传参数就拒绝」正是设计意图。 | 把 `guard-selftest.mjs` 各场景的 `prepare-data.mjs` 调用改为带 `--preserve-translations`（注入坏行的场景同样需要，否则守卫会先于被注入的判据触发）；或在隔离副本里先清空 `descriptionZh` 再调用。 | `tools/guard-selftest.mjs:78,108,148,…`（`run(dir,'prepare-data.mjs')`），配合 `tools/prepare-data.mjs:56-92`（守卫实现） |
| **T2** | low | `data/translation/README.md` 第 11 节的流水线示例仍写作 `node tools/prepare-data.mjs` 并声称「descriptionZh 会被重置为 ""」，与新的守卫行为不一致（现在不带参数会直接拒绝运行）。使用者照抄会得到 exit 1 与一段拒绝信息。 | 把该节示例改为 `node tools/prepare-data.mjs --reset-translations`（从零重建）并补一句「只想幂等重建用 `--preserve-translations`」。 | `data/translation/README.md:122`（示例）、`:128-130`（说明） |
| **T3** | low（信息） | 交付验证器的负向测试 `N3` 期望值过期：t7 写它是为了证明「坏行检测存在盲区」，而 t10 的加固**已经封死**该盲区，加固后的 `prepare-data` 会正确拒绝该形态，于是 `node tools/verify-bundle.mjs` 现在报 `116/117`，唯一失败项是这条过期断言。 | 把 `N3` 断言改为「必须被拒绝」并改名为回归用例（或直接删除，由 `tools/guard-selftest.mjs` 的 `probe-bareflag` 承接）。该断言属验证器自身，不影响交付物。 | `tools/verify-bundle.mjs`（S11 的 N3 段） |

**未修正说明**：T1–T3 全部位于 `tools/`（本轮约束为「只写 README.md 与报告文件」），故只登记不修改；
`README.md` 已如实说明 T1/T2 的影响与修复方式，使用者不会被误导。

---

## 5. 未验证项（与 README §未验证项一致）

1. 像素级视觉/样式回归（只验证 DOM 结构与文本，无截图比对）。
2. 系统级剪贴板落盘内容与「手动复制面板」的人工操作路径（已验证传给剪贴板 API 的字符串）。
3. 与真实 CS2 客户端 `cvarlist` / `help` 的逐条比对（环境无游戏客户端）。
4. 子路径部署实测（仅静态分析：绝对路径会 404）。
5. 非 Windows 平台与非 Chrome 浏览器。
6. 2023-10-02 快照与当前 CS2 版本的数据新鲜度差异。

---

## 6. 交付结论

- 交付物齐备：数据集（2528 条 / 1587 条中文）、React 前端（构建产物与源数据字节一致）、工具链、**`README.md` 交付说明**、完整验证证据链。
- 全链路（搜索 → 筛选 → 多选 → 一键复制）在真实浏览器中实测可用；分发副本已确认为**合并后**版本。
- 遗留问题仅 3 项工具/文档一致性小问题（T1 medium、T2/T3 low），**不影响交付数据的正确性与前端功能**。

---

## 7. 补记（T3 收口，append-only）

按 captain 指示，T3 已在验证器作者的作用域内收口（**只改 `tools/verify-bundle.mjs`，未改任何交付数据**）：

- `N3` 从「断言该反例会被静默放过」改为「**断言该反例现在必须被拒绝**」的反向回归用例：
  断言 `exit ≠ 0`、失败信息点名 `zzz_verify_gap_probe`、拒绝来自 t10 新增的正交「错位防护」判据
  （**不是**误触发「防误删译文」守卫，也不是计数断言），并同时断言旧判据 A/B 依然命中不了该形态
  （即「盲区」的定义仍成立，只是被新判据补上了）。
- 复跑结果：**120 / 120 通过，`RESULT: ALL CHECKS PASS`，exit 0**（原 117 项断言 + S11 新增 3 项）。
  关键真实输出：

  ```
  N3 反向回归：prepare-data 退出码=1（拒绝=true，点名该行=true，来自新增错位判据=true，误触发防误删守卫=false）
     失败信息：FAILED: no misaligned row (bare engine-flag token as Default Value / value duplicated into the Flags cell):
               zzz_verify_gap_probe(defaultValue="cl" flags=[sv] defaultValue "cl" is a bare engine-flag token)
     旧判据是否仍命中：prepare 的 run-on 判据=false、HTML 判据A=false、判据B=false（全为 false ⇒ 确属原盲区）
     是否产出污染行：null
  [PASS] 负向测试 N3（反向回归）：t7 的盲区反例现在必须被 prepare-data 拒绝，退出码非 0 且失败信息点名该行
  [PASS] N3 的拒绝来自 t10 新增的正交「错位防护」判据，而不是误触发「防误删译文」守卫或计数断言
  [PASS] N3：该形态确实不被旧的两级判据覆盖（盲区定义成立），盲区现已封死
  通过 120 / 120；失败 0；未验证 0
  RESULT: ALL CHECKS PASS
  ```
- 交付说明 `README.md` 已同步：不再出现「116/117 / 过期断言」的表述，改为「120/120 全绿」并说明 N3 的反向回归语义；
  §已知限制第 6 条的量词也由「4 处」校准为与 `app/README.md` 一致的「**4 种译文变体，影响 6 条命令**」。
- T1（`tools/guard-selftest.mjs` 与 CLI 守卫未对齐）与 T2（`data/translation/README.md:122` 示例过期）
  已由 captain 另开 **t13** 交数据工程侧处理，**不改动交付数据**。
