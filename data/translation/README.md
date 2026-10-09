# CS2 控制台命令中文翻译规范（v1）

> 本目录由 `tools/prepare-data.mjs` 生成，**不要手工修改** `glossary.json`、`chunks/`；
> 如需增补术语或调整切片，请改脚本后重新运行（脚本幂等、离线可跑）。

## 1. 目标

把 `data/commands.json` 中每条命令的 `descriptionEn`（英文说明）翻译成简体中文，
由 merge 任务写回对应命令的 `descriptionZh`。数据集共 **2528** 条命令，
其中 **1587** 条带英文说明；去重后为 **1465** 条唯一说明，
切成 **10** 个工作单元（每单元 ≤ 150 条）。

## 2. 输入（只读）

`data/translation/chunks/chunk-NNN.json`：

```json
{ "chunk": "chunk-001", "indices": [0, 1, 2], "descriptions": ["英文说明 A", "英文说明 B", "英文说明 C"] }
```

- `indices` 是**全局描述索引**（0 基、升序、全局唯一、跨 chunk 连续无缺口）。
- `indices[i]` 对应 `descriptions[i]`，两者等长。

## 3. 输出（必须严格遵守）

`data/translation/out/chunk-NNN.json`，文件名与输入 chunk 一一对应：

```json
{
  "chunk": "chunk-001",
  "entries": {
    "0": "把英文说明 A 翻译成中文",
    "1": "把英文说明 B 翻译成中文",
    "2": "把英文说明 C 翻译成中文"
  }
}
```

## 4. 硬性约束（verify 会逐条检查）

1. `entries` 的 key 集合必须与该 chunk 的 `indices` **完全一致**：不多、不少、不重。
2. key 是**字符串形式的十进制索引**（`"0"`、`"137"`），不是数组下标、不是对象。
3. 每条译文必须是**非空字符串**，且至少包含一个 CJK 汉字；不允许留空、不允许占位符 (`TODO`/`TBD`)。
4. 不允许整条照抄英文：必须给出中文表述（专有名词可保留原文，见第 6 节）。
5. 只写 `data/translation/out/<自己的 chunk>.json`；**不要改** `data/commands.json`、`chunks/`、`glossary.json`。
6. 译文内不要出现换行符；首尾不要有多余空格。
7. 不添加原文没有的功能、数值或限制；不省略原文的限制条件与默认取值说明。
8. 一条原文对应一条译文，保持 `indices` 与 `descriptions` 的位置关系，不要合并或拆分条目。

## 5. 风格约定

- 面向 CS2 玩家与服务器管理员，简明直白。
- 命令类描述用动词开头：`显示…`、`开启…`、`设置…`、`打印…`、`切换…`。
- 变量类描述说明"这个变量控制什么"，必要时补一句取值含义。
- 取值枚举保留数字与语义：`0 = off, 1 = on` → `0 = 关闭，1 = 开启`。
- 中文用全角标点（，、。；：），但标识符、数字、单位、路径内一律保持半角原样。
- 句末一般不加句号；原文明显是完整句子时可保留中文句号。
- 括号统一用全角`（）`；但占位符与函数式写法保持原样（如 `func_door(open)`）。
- 长度尽量不超过原文的 1.5 倍，避免在前端表格里被截断。

示例：

| 英文原文 | 推荐译文 |
| --- | --- |
| Show team selection window | 显示队伍选择窗口 |
| Activates SourceTV on server. | 在服务器上启用 SourceTV |
| Max number of broadcast1 http requests in flight. | 正在进行的 broadcast1 HTTP 请求数量上限 |
| Dispatch clients to relay proxies: 0=never, 1=if appropriate, 2=always | 向中继代理分发客户端：0 = 从不，1 = 视情况，2 = 总是 |
| Allow cheats on server | 允许在服务器上使用作弊（需 sv_cheats 1） |

## 6. 专有名词不译清单

- **标识符**：控制台标识符一律保持原样：sv_*、cl_*、mp_*、tv_*、host_*、r_*、dsp_*、func_*、weapon_*、item_*、以及以 "+" / "-" 开头的命令（如 +attack、-jump）。
- **占位符**：参数占位符保持原样：{...}、<...>、%s / %1、以及形如 <player>、<index>、<entity_name> 的尖括号参数。
- **取值**：取值枚举保持原样：0、1、2、true、false、on、off、cmd、default、-1、浮点数与单位（秒/毫秒/像素）。
- **路径/资源名**：资源路径与文件名保持原样：de_dust2、cs_office、*.vpk、particles/…、sound/…。
- **技术缩写**：技术缩写保留英文：HUD、FPS、LOD、GOTV、SourceTV、demo、tick、subtick、nav、NPC、FOV、CPU、GPU、VRAM、URL、HTTP、TCP、UDP、IP、Steam、SteamID、CS2、Counter-Strike、Premier、Wingman。

## 7. 一致性

先读 `data/translation/glossary.json`：`flags`（21 个引擎标记的中文名与说明）、
`terms`（179 条核心术语）、`doNotTranslate`、`valueTokens`。
同一英文词在同一批译文里必须用同一译法；术语表里没有的词，按第 5 节风格自定，并在交付说明里列出。

## 8. 提交前自检

```bash
node -e "const c=require('./data/translation/chunks/chunk-001.json');const o=require('./data/translation/out/chunk-001.json');\
const a=c.indices.map(String).sort().join(',');const b=Object.keys(o.entries).sort().join(',');\
console.log(a===b?'keys OK':'KEYS MISMATCH');console.log(Object.values(o.entries).every(v=>/[\\u4e00-\\u9fff]/.test(v))?'CJK OK':'CJK MISSING')"
```

## 9. 数据溯源与已知修复

- `data/commands.json.meta.repairedRows`：**4 条** wiki 渲染损坏行，逐条给出「原始单元格内容 →
  还原后字段」。现有 4 条为 `tv_broadcast_url`、`tv_broadcast_url1`、
  `cl_promoted_settings_acknowledged`、`sv_mapvetopickvote_phase_duration`；其 `descriptionEn`
  已按还原后的英文原文给出，翻译时直接按该英文处理即可。
- `data/commands.json.meta.droppedPlaceholderRows`：2 条空字母段落（X、Y）的 N/A 占位行，已丢弃。
- `node tools/verify-dataset.mjs` 会独立扫描 `data/raw/cs2_wiki.html`，用两条互不依赖的判据
  （单元格内 `&#160;` 紧邻 `:`；Flags 列出现非白名单 token）重算损坏行集合，并断言它与
  `meta.repairedRows` 完全一致；一旦 wiki 再现同类坏行、或某条修复不再对应源数据，校验会
  **直接失败（exit 1）而不是静默通过**。构建脚本 `tools/prepare-data.mjs` 同样会因此失败。
- `data/translation/chunks/*.json` 采用 write-if-changed 写入：内容不变时**不会重写文件**
  （字节与 mtime 都保持不动），因此重建数据集不会打断正在进行的翻译工作。

## 10. 源站缺陷台账（`meta.sourceDefects`）

有些英文描述**在 wiki 原文里就是残缺的**（括号不闭合、多余空格、`Changes's` 这类所有格错误、
单词重复等）。它们**不是**翻译缺陷：

- 翻译时**逐字保留原文的残缺形态**，不要补全括号、不要删除多余空格、不要把 `Changes's` 改成
  `Changes`——译文只要如实传达原文意思即可，保持同样的残缺。
- 校验/评审时，`meta.sourceDefects.entries` 里列出的**描述索引不得判为翻译缺陷**。
- 台账由本脚本按 8 条确定性规则（括号配对、括号内侧空格、复数所有格、单词重复、句号后缺空格、
  标点重复、连续空格、双引号计数）从全部 1465 条唯一描述里重新扫描生成；
  `tools/verify-dataset.mjs` 会独立复算并断言「扫描到的缺陷必须全部登记」，未登记即失败。

## 11. 数据流水线（顺序不可颠倒）

**语义（务必记住）**：`prepare-data` 负责**重置**译文，`merge-translations` 负责**回填**译文。
所以重跑的正确顺序永远是 `prepare-data` → `merge-translations` → `verify-dataset`。

```bash
# ① 首次构建（数据集/译文还不存在）：无开关即可
node tools/prepare-data.mjs

# ② 已合并的树上重跑（推荐，安全）：用 --preserve-translations 保留 1587 条译文
node tools/prepare-data.mjs --preserve-translations
node tools/merge-translations.mjs
node tools/verify-dataset.mjs

# ③ 确实要重新准备数据（会清空 descriptionZh，必须再跑 merge 回填）
node tools/prepare-data.mjs --reset-translations
node tools/merge-translations.mjs
node tools/verify-dataset.mjs
```

⚠️ 在**已合并**的树上直接执行 `node tools/prepare-data.mjs`（无开关）会**拒绝运行**（exit 1，
且不写任何文件）——因为那会静默抹掉全部译文。

### 安全开关（防止静默丢译文）

```bash
node tools/prepare-data.mjs                          # 已合并的树：直接报错退出，提示如何继续
node tools/prepare-data.mjs --preserve-translations  # 保留现有译文（可字节一致地重建）
node tools/prepare-data.mjs --reset-translations     # 明确同意重置，之后必须再跑 merge
node tools/prepare-data.mjs --help                   # 用法
```

- **默认（无开关）= 安全的那一侧**：检测到 `data/commands.json` 里已有非空 `descriptionZh` 就退出，
  并报出条数与示例命令，绝不静默抹掉译文。
- `--preserve-translations`：按命令把已有译文回填（仅当该条 `descriptionEn` 未变），
  `commands.json` 也是 write-if-changed 写入——因此内容不变时**连 mtime 都不动**。
- `--reset-translations`：真正执行重置；**必须**紧接着跑 `tools/merge-translations.mjs`。
- `tools/guard-selftest.mjs` 里有对应的负向测试（`merged-refuse` / `merged-preserve` /
  `clean-default-run` / `roundtrip`），可随时复跑验证。

- 三个脚本都幂等、离线可跑；重复执行产物字节一致。
- `prepare-data.mjs` **不会**触碰 `data/translation/out/`（译者产物），且 chunk 文件是 write-if-changed
  写入的——所以重跑它不会打断翻译进度。
