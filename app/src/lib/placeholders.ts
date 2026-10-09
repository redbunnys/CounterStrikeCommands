/**
 * 参数占位符中文释义表（自动生成，请勿手改）。
 *
 * 生成脚本：app/scripts/inline-parameter-tokens.mjs
 * 数据来源：data/translation/parameter-tokens.md（释义）+ data/commands.json（真实写法与出现次数）
 *
 * 规则（对 translator 与前端都生效）：
 *  - 占位符在 descriptionZh 中逐字保留英文原文，因为它们要能直接粘进 .cfg / 控制台。
 *  - `<t\|ct>` 里的反斜杠是源站原文（MediaWiki 转义），属于正确数据：既不改写，也不清洗。
 *  - 当前数据集共 85 种写法、753 处出现，分布在 130 条命令的描述里；
 *    其中 glossary 79 种、derived 3 种、variant 3 种。
 *  - 译文中另有 1 种全角方括号变体（`［mod 作者使用］`，源自 `[mod authors use this]`，见 sv_disable_immunity_alpha）
 *    不在本脚本的扫描范围内（扫描只认 `[]`/`{}`/`<>` 半角括号）：**4 种译文变体合计影响 6 条命令**，
 *    它们都是描述性修饰语而非可复制参数，界面一律按普通文本显示、不加注解（详见 app/README 的裁定说明）。
 *  - 前端只做“展示层”的中文注解，绝不改写文本本身：renderPlaceholderSegments() 拼接后必须逐字等于原文。
 */

export interface PlaceholderToken {
  /** 数据中出现的原始写法（逐字保留，含反斜杠） */
  token: string;
  /** 中文释义（tooltip / 行内注解用） */
  zh: string;
  /** 在 commands.json 描述里的出现次数（生成时统计） */
  count: number;
  /**
   * glossary = 与 parameter-tokens.md 精确对应；
   * derived  = 表格未直接收录，但由已收录的子占位符合成（如 `[<max distance>]`）；
   * variant  = 译文中出现的中文变体（不是占位符，界面不做注解）；
   */
  source: 'glossary' | 'derived' | 'variant';
}

/** 按长度降序排列，保证 `{class_name}` 之类的复合写法先于其子串被匹配。 */
export const PLACEHOLDER_TOKENS: PlaceholderToken[] = [
  { token: "[inner = cl_crosshairsize*(1-cl_crosshair_dynamic_maxdist_splitratio), outer = cl_crosshairsize*cl_crosshair_dynamic_maxdist_splitratio]", zh: "内间距 = cl_crosshairsize×(1-cl_crosshair_dynamic_maxdist_splitratio)，外间距 = cl_crosshairsize×cl_crosshair_dynamic_maxdist_splitratio", count: 1, source: 'glossary' },
  { token: "[inner = cl_crosshairsize*(1-cl_crosshair_dynamic_maxdist_splitratio)，outer = cl_crosshairsize*cl_crosshair_dynamic_maxdist_splitratio]", zh: "（译文中出现的中文变体，不是占位符）", count: 1, source: 'variant' },
  { token: "<{entity_name} / {class_name} / {entity_index} / {no argument = pick what player is looking at}>", zh: "实体名称 / 实体类名 / 实体编号 / 不带参数时取玩家正看向的目标", count: 14, source: 'glossary' },
  { token: "{no argument = pick what player is looking at}", zh: "不带参数时 = 取当前玩家正看向的目标", count: 118, source: 'glossary' },
  { token: "[within 256 units of the player]", zh: "玩家周围 256 单位范围内", count: 2, source: 'glossary' },
  { token: "<ent index or -1 for all>", zh: "实体编号；-1 表示全部", count: 4, source: 'glossary' },
  { token: "[<player name or index>]", zh: "玩家名称或编号", count: 2, source: 'derived' },
  { token: "<weapon subclass name>", zh: "武器子类别名称", count: 2, source: 'glossary' },
  { token: "[mod authors use this]", zh: "供 Mod 作者使用", count: 1, source: 'glossary' },
  { token: "<optional: allangles>", zh: "可选参数：allangles（全角度）", count: 2, source: 'glossary' },
  { token: "<markup_group name>", zh: "标记分组名称", count: 4, source: 'glossary' },
  { token: "[<retrigger time>]", zh: "重复触发间隔时间", count: 4, source: 'derived' },
  { token: "<lifetime = 10.0>", zh: "存活时间（秒），默认 10.0", count: 8, source: 'glossary' },
  { token: "<new entity name>", zh: "新的实体名称", count: 4, source: 'glossary' },
  { token: "<threshold bytes>", zh: "阈值（字节）", count: 2, source: 'glossary' },
  { token: "[near the player]", zh: "玩家附近", count: 2, source: 'glossary' },
  { token: "<health to lose>", zh: "扣除的生命值", count: 2, source: 'glossary' },
  { token: "<option:entname>", zh: "可选参数：实体名称", count: 4, source: 'glossary' },
  { token: "[<max distance>]", zh: "最大距离", count: 4, source: 'derived' },
  { token: "<distance 1024>", zh: "距离（默认 1024）", count: 2, source: 'glossary' },
  { token: "<distance away>", zh: "距离", count: 2, source: 'glossary' },
  { token: "<roll:optional>", zh: "横滚角（可选）", count: 4, source: 'glossary' },
  { token: "<new_subclass>", zh: "新的子类别", count: 2, source: 'glossary' },
  { token: "<scale factor>", zh: "缩放系数", count: 4, source: 'glossary' },
  { token: "[玩家 256 单位范围内]", zh: "（译文中出现的中文变体，不是占位符）", count: 2, source: 'variant' },
  { token: "{entity_index}", zh: "实体编号", count: 118, source: 'glossary' },
  { token: "<effect name>", zh: "效果名称", count: 2, source: 'glossary' },
  { token: "<entity name>", zh: "实体名称", count: 4, source: 'glossary' },
  { token: "<heuristic #>", zh: "启发式编号", count: 2, source: 'glossary' },
  { token: "<magnitude 0>", zh: "强度（0 表示关闭）", count: 2, source: 'glossary' },
  { token: "<weaponclass>", zh: "武器类别", count: 2, source: 'glossary' },
  { token: "<world_index>", zh: "世界（地图）编号", count: 4, source: 'glossary' },
  { token: "[output name]", zh: "输出名称", count: 2, source: 'glossary' },
  { token: "{0=no, 1=yes}", zh: "可选值：0 = 否，1 = 是", count: 2, source: 'glossary' },
  { token: "{entity_name}", zh: "实体名称", count: 122, source: 'glossary' },
  { token: "<class name>", zh: "类名", count: 2, source: 'glossary' },
  { token: "<difficulty>", zh: "难度", count: 12, source: 'glossary' },
  { token: "<globalname>", zh: "全局变量名", count: 2, source: 'glossary' },
  { token: "<not_bomber>", zh: "非炸弹携带者", count: 2, source: 'glossary' },
  { token: "{.vmdl name}", zh: "模型文件名（.vmdl）", count: 4, source: 'glossary' },
  { token: "{any, CT, T}", zh: "可选值：任意 / 反恐精英 / 恐怖分子", count: 2, source: 'glossary' },
  { token: "{class_name}", zh: "实体类名", count: 122, source: 'glossary' },
  { token: "{time r g b}", zh: "时间（秒）与红、绿、蓝三个分量", count: 4, source: 'glossary' },
  { token: "<classname>", zh: "类名", count: 2, source: 'glossary' },
  { token: "<eventname>", zh: "事件名称", count: 4, source: 'glossary' },
  { token: "<exit code>", zh: "进程退出码", count: 2, source: 'glossary' },
  { token: "<item_name>", zh: "物品名称", count: 2, source: 'glossary' },
  { token: "<magnitude>", zh: "强度", count: 2, source: 'glossary' },
  { token: "<substring>", zh: "子字符串", count: 4, source: 'glossary' },
  { token: "<funcname>", zh: "函数名", count: 4, source: 'glossary' },
  { token: "<concept>", zh: "概念", count: 2, source: 'glossary' },
  { token: "<flags 0>", zh: "标志位（0 表示关闭）", count: 2, source: 'glossary' },
  { token: "<mapname>", zh: "地图名称", count: 4, source: 'glossary' },
  { token: "<r g b a>", zh: "红、绿、蓝、透明度四个分量", count: 8, source: 'glossary' },
  { token: "<scale 0>", zh: "缩放值（0 表示关闭）", count: 2, source: 'glossary' },
  { token: "<varname>", zh: "变量名", count: 2, source: 'glossary' },
  { token: "<x value>", zh: "X 轴数值", count: 4, source: 'glossary' },
  { token: "<y value>", zh: "Y 轴数值", count: 4, source: 'glossary' },
  { token: "<z value>", zh: "Z 轴数值", count: 4, source: 'glossary' },
  { token: "[0.3 - 1]", zh: "取值范围 0.3 - 1", count: 2, source: 'glossary' },
  { token: "<Radius>", zh: "半径", count: 4, source: 'glossary' },
  { token: "<commit>", zh: "提交", count: 2, source: 'glossary' },
  { token: "<player>", zh: "玩家", count: 4, source: 'glossary' },
  { token: "<target>", zh: "目标", count: 6, source: 'glossary' },
  { token: "[action]", zh: "动作", count: 2, source: 'glossary' },
  { token: "<delay>", zh: "延迟时间", count: 2, source: 'glossary' },
  { token: "<flags>", zh: "标志位", count: 2, source: 'glossary' },
  { token: "<index>", zh: "编号", count: 4, source: 'glossary' },
  { token: "<scale>", zh: "缩放值", count: 2, source: 'glossary' },
  { token: "<skill>", zh: "技能值（0-100）", count: 2, source: 'glossary' },
  { token: "<state>", zh: "状态", count: 2, source: 'glossary' },
  { token: "<t\\|ct>", zh: "阵营筛选：t（恐怖分子）或 ct（反恐精英）", count: 4, source: 'glossary' },
  { token: "<value>", zh: "数值", count: 4, source: 'glossary' },
  { token: "[0 - 1]", zh: "取值范围 0 - 1", count: 4, source: 'glossary' },
  { token: "[delay]", zh: "延迟时间", count: 4, source: 'glossary' },
  { token: "[value]", zh: "数值", count: 4, source: 'glossary' },
  { token: "<name>", zh: "名称", count: 10, source: 'glossary' },
  { token: "<type>", zh: "类型", count: 10, source: 'glossary' },
  { token: "[玩家附近]", zh: "（译文中出现的中文变体，不是占位符）", count: 2, source: 'variant' },
  { token: "<all>", zh: "是否对全部目标生效", count: 4, source: 'glossary' },
  { token: "<ct>", zh: "反恐精英阵营", count: 2, source: 'glossary' },
  { token: "<N>", zh: "数量", count: 2, source: 'glossary' },
  { token: "<t>", zh: "恐怖分子阵营", count: 2, source: 'glossary' },
  { token: "[0]", zh: "取值 0", count: 2, source: 'glossary' },
  { token: "[1]", zh: "取值 1", count: 6, source: 'glossary' },
];

/** 运行时扫描用：把全部占位符按长度降序拼成一个锚定正则（无捕获组，便于 split）。 */
export const PLACEHOLDER_PATTERN: RegExp = new RegExp(
  PLACEHOLDER_TOKENS.map((entry) => entry.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

const MEANING = new Map(PLACEHOLDER_TOKENS.map((entry) => [entry.token, entry]));

/** 查某个占位符的中文释义；未收录返回 undefined（界面只做原样展示） */
export function placeholderMeaning(token: string): string | undefined {
  return MEANING.get(token)?.zh;
}

export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'placeholder'; text: string; zh: string; source: PlaceholderToken['source'] };

/**
 * 把描述切成「普通文本 / 占位符」片段，供 React 渲染 tooltip 与行内注解。
 * 不变式：segments.map(s => s.text).join('') === input（逐字保留，含反斜杠与空格）。
 */
export function renderPlaceholderSegments(input: string): TextSegment[] {
  const text = input ?? '';
  if (text === '') return [];
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
    const token = match[0];
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, match.index) });
    }
    const entry = MEANING.get(token);
    segments.push({
      kind: 'placeholder',
      text: token,
      zh: entry?.zh ?? token,
      source: entry?.source ?? 'glossary',
    });
    lastIndex = match.index + token.length;
    if (token.length === 0) PLACEHOLDER_PATTERN.lastIndex += 1;
  }
  if (lastIndex < text.length) segments.push({ kind: 'text', text: text.slice(lastIndex) });
  return segments;
}

/** 命中过占位符的文本里，占位符总数（用于统计与自测） */
export function countPlaceholders(input: string): number {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  const matches = (input ?? '').match(PLACEHOLDER_PATTERN);
  return matches ? matches.length : 0;
}
