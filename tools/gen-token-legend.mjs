/**
 * Generate data/translation/parameter-tokens.md — the canonical Chinese legend
 * for every parameter placeholder token that appears in the wiki descriptions.
 *
 * Decision (captain, after audit): tokens stay VERBATIM in descriptionZh,
 * because they are technical parameters that must survive copy-paste into a
 * config file. Readability for Chinese users is provided by this legend, which
 * the frontend renders as a hint, instead of by translating the tokens.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CHUNKS = 10;
const chunks = [];
for (let i = 1; i <= CHUNKS; i++) {
  const n = `chunk-${String(i).padStart(3, '0')}`;
  chunks.push(JSON.parse(readFileSync(`data/translation/chunks/${n}.json`, 'utf8')));
}

const counts = new Map();
for (const c of chunks) {
  for (const d of c.descriptions) {
    for (const m of d.match(/[\[{]([^{}\[\]<>]*)[\]}]|<([^<>]*)>/g) ?? []) {
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  }
}

/** Chinese explanation for each token. Keys must match the token text exactly. */
const LEGEND = {
  '{entity_name}': '实体名称',
  '{class_name}': '实体类名',
  '{entity_index}': '实体编号',
  '{no argument = pick what player is looking at}': '不带参数时 = 取当前玩家正看向的目标',
  '<{entity_name} / {class_name} / {entity_index} / {no argument = pick what player is looking at}>':
    '实体名称 / 实体类名 / 实体编号 / 不带参数时取玩家正看向的目标',
  '<exit code>': '进程退出码',
  '<lifetime = 10.0>': '存活时间（秒），默认 10.0',
  '<r g b a>': '红、绿、蓝、透明度四个分量',
  '{time r g b}': '时间（秒）与红、绿、蓝三个分量',
  '<r g b>': '红、绿、蓝三个分量',
  '<type>': '类型',
  '<difficulty>': '难度',
  '<name>': '名称',
  '<all>': '是否对全部目标生效',
  '<t\\|ct>': '阵营筛选：t（恐怖分子）或 ct（反恐精英）',
  '<not_bomber>': '非炸弹携带者',
  '<t>': '恐怖分子阵营',
  '<ct>': '反恐精英阵营',
  '<mapname>': '地图名称',
  '<value>': '数值',
  '<player>': '玩家',
  '<player name or index>': '玩家名称或编号',
  '<target>': '目标',
  '<world_index>': '世界（地图）编号',
  '<eventname>': '事件名称',
  '<event name>': '事件名称',
  '<effect name>': '效果名称',
  '<entity name>': '实体名称',
  '<new entity name>': '新的实体名称',
  '<class name>': '类名',
  '<markup_group name>': '标记分组名称',
  '<weapon class>': '武器类别',
  '<weapon subclass name>': '武器子类别名称',
  '<weaponclass>': '武器类别',
  '<skill>': '技能值（0-100）',
  '<ent index or -1 for all>': '实体编号；-1 表示全部',
  '<x value>': 'X 轴数值',
  '<y value>': 'Y 轴数值',
  '<z value>': 'Z 轴数值',
  '<scale factor>': '缩放系数',
  '<scale 0>': '缩放值（0 表示关闭）',
  '<magnitude 0>': '强度（0 表示关闭）',
  '<flags 0>': '标志位（0 表示关闭）',
  '<threshold bytes>': '阈值（字节）',
  '<health to lose>': '扣除的生命值',
  '<retrigger time>': '重复触发间隔时间',
  '<max distance>': '最大距离',
  '<distance away>': '距离',
  '<distance 1024>': '距离（默认 1024）',
  '<optional: allangles>': '可选参数：allangles（全角度）',
  '<heuristic #>': '启发式编号',
  '{any, CT, T}': '可选值：任意 / 反恐精英 / 恐怖分子',
  '{0=no, 1=yes}': '可选值：0 = 否，1 = 是',
  '{.vmdl name}': '模型文件名（.vmdl）',
  '<duration>': '持续时间',
  '<delay>': '延迟时间',
  '<index>': '编号',
  '<count>': '数量',
  '<size>': '大小',
  '<color>': '颜色',
  '<text>': '文本',
  '<message>': '消息内容',
  '<command>': '命令',
  '<filename>': '文件名',
  '<pattern>': '匹配模式',
  '<key>': '按键',
  '<mode>': '模式',
  '<amount>': '数量',
  '<speed>': '速度',
  '<time>': '时间',
  '<bool>': '布尔值（0/1）',
  '<0-1>': '取值范围 0-1',
  '<n>': '数量',
  '<id>': '编号',
  '<string>': '字符串',
  '<path>': '路径',
  '<ip>': 'IP 地址',
  '<port>': '端口',
  '<seconds>': '秒数',
  '<minutes>': '分钟数',
  '<％s>': '格式化占位符',
  '%s': '格式化占位符（会被替换为实际值）',
  '%d': '格式化占位符（会被替换为整数）',
  '%f': '格式化占位符（会被替换为小数）',
  '[1]': '取值 1',
  '[0]': '取值 0',
  '[0 - 1]': '取值范围 0 - 1',
  '[0.3 - 1]': '取值范围 0.3 - 1',
  '[delay]': '延迟时间',
  '[value]': '数值',
  '[action]': '动作',
  '[output name]': '输出名称',
  '[mod authors use this]': '供 Mod 作者使用',
  '[near the player]': '玩家附近',
  '[within 256 units of the player]': '玩家周围 256 单位范围内',
  '[inner = cl_crosshairsize*(1-cl_crosshair_dynamic_maxdist_splitratio), outer = cl_crosshairsize*cl_crosshair_dynamic_maxdist_splitratio]':
    '内间距 = cl_crosshairsize×(1-cl_crosshair_dynamic_maxdist_splitratio)，外间距 = cl_crosshairsize×cl_crosshair_dynamic_maxdist_splitratio',
  '<roll:optional>': '横滚角（可选）',
  '<classname>': '类名',
  '<commit>': '提交',
  '<concept>': '概念',
  '<flags>': '标志位',
  '<funcname>': '函数名',
  '<globalname>': '全局变量名',
  '<item_name>': '物品名称',
  '<magnitude>': '强度',
  '<N>': '数量',
  '<new_subclass>': '新的子类别',
  '<option:entname>': '可选参数：实体名称',
  '<Radius>': '半径',
  '<scale>': '缩放值',
  '<state>': '状态',
  '<substring>': '子字符串',
  '<varname>': '变量名',
};

const tokens = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const missing = tokens.filter(([t]) => LEGEND[t] === undefined);

const lines = [];
lines.push('# 参数占位符（Parameter tokens）中文对照表');
lines.push('');
lines.push('## 规则（对 translator 与前端都生效）');
lines.push('');
lines.push('1. 这些参数占位符在 `descriptionZh` 中**逐字保留原文**，不要翻译、不要改写。');
lines.push('   原因：它们是可直接粘进 `.cfg` / 控制台的**技术参数**，改译会改坏可复制性。');
lines.push('   - 保留原样：`{entity_name}`、`<player>`、`<mapname>`、`<t\\|ct>`');
lines.push('2. 括号**外层**的普通英文描述必须翻译成中文（例如 "Arguments: x y z" → "参数：x y z"）。');
lines.push('3. 中文可读性由本对照表提供：前端在展示描述时，把命中的占位符渲染为中文提示（tooltip 或紧随其后的小字释义）。');
lines.push('4. `<t\\|ct>` 中的反斜杠是源站原文（MediaWiki 转义），**不要改动、不要删除**。');
lines.push('');
lines.push(`共出现 ${tokens.length} 种占位符。下表按出现次数降序。`);
lines.push('');
lines.push('| 占位符 | 出现次数 | 中文释义 |');
lines.push('| --- | --- | --- |');
for (const [t, n] of tokens) {
  const zh = LEGEND[t] ?? '（待补充）';
  lines.push(`| \`${t.replace(/\|/g, '\\|')}\` | ${n} | ${zh} |`);
}
lines.push('');
if (missing.length) {
  lines.push('## 待补充释义');
  lines.push('');
  for (const [t] of missing) lines.push(`- \`${t}\``);
  lines.push('');
}

writeFileSync('data/translation/parameter-tokens.md', lines.join('\n'), 'utf8');
console.log(JSON.stringify({
  distinctTokens: tokens.length,
  coveredByLegend: tokens.length + missing.length - missing.length,
  missingLegend: missing.map(([t]) => t),
  totalOccurrences: tokens.reduce((a, [, n]) => a + n, 0),
}, null, 2));
console.log('saved: data/translation/parameter-tokens.md');
