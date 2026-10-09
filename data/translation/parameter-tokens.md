# 参数占位符（Parameter tokens）中文对照表

## 规则（对 translator 与前端都生效）

1. 这些参数占位符在 `descriptionZh` 中**逐字保留原文**，不要翻译、不要改写。
   原因：它们是可直接粘进 `.cfg` / 控制台的**技术参数**，改译会改坏可复制性。
   - 保留原样：`{entity_name}`、`<player>`、`<mapname>`、`<t\|ct>`
2. 括号**外层**的普通英文描述必须翻译成中文（例如 "Arguments: x y z" → "参数：x y z"）。
3. 中文可读性由本对照表提供：前端在展示描述时，把命中的占位符渲染为中文提示（tooltip 或紧随其后的小字释义）。
4. `<t\|ct>` 中的反斜杠是源站原文（MediaWiki 转义），**不要改动、不要删除**。

共出现 82 种占位符。下表按出现次数降序。

| 占位符 | 出现次数 | 中文释义 |
| --- | --- | --- |
| `{class_name}` | 34 | 实体类名 |
| `{entity_name}` | 34 | 实体名称 |
| `{entity_index}` | 33 | 实体编号 |
| `{no argument = pick what player is looking at}` | 33 | 不带参数时 = 取当前玩家正看向的目标 |
| `<difficulty>` | 6 | 难度 |
| `<name>` | 5 | 名称 |
| `<type>` | 5 | 类型 |
| `<{entity_name} / {class_name} / {entity_index} / {no argument = pick what player is looking at}>` | 4 | 实体名称 / 实体类名 / 实体编号 / 不带参数时取玩家正看向的目标 |
| `[1]` | 3 | 取值 1 |
| `<target>` | 3 | 目标 |
| `[0 - 1]` | 2 | 取值范围 0 - 1 |
| `[delay]` | 2 | 延迟时间 |
| `[value]` | 2 | 数值 |
| `{.vmdl name}` | 2 | 模型文件名（.vmdl） |
| `{time r g b}` | 2 | 时间（秒）与红、绿、蓝三个分量 |
| `<all>` | 2 | 是否对全部目标生效 |
| `<ent index or -1 for all>` | 2 | 实体编号；-1 表示全部 |
| `<entity name>` | 2 | 实体名称 |
| `<eventname>` | 2 | 事件名称 |
| `<lifetime = 10.0>` | 2 | 存活时间（秒），默认 10.0 |
| `<mapname>` | 2 | 地图名称 |
| `<markup_group name>` | 2 | 标记分组名称 |
| `<max distance>` | 2 | 最大距离 |
| `<player>` | 2 | 玩家 |
| `<r g b a>` | 2 | 红、绿、蓝、透明度四个分量 |
| `<retrigger time>` | 2 | 重复触发间隔时间 |
| `<roll:optional>` | 2 | 横滚角（可选） |
| `<t\\|ct>` | 2 | 阵营筛选：t（恐怖分子）或 ct（反恐精英） |
| `<value>` | 2 | 数值 |
| `<world_index>` | 2 | 世界（地图）编号 |
| `<x value>` | 2 | X 轴数值 |
| `<y value>` | 2 | Y 轴数值 |
| `<z value>` | 2 | Z 轴数值 |
| `[0.3 - 1]` | 1 | 取值范围 0.3 - 1 |
| `[0]` | 1 | 取值 0 |
| `[action]` | 1 | 动作 |
| `[inner = cl_crosshairsize*(1-cl_crosshair_dynamic_maxdist_splitratio), outer = cl_crosshairsize*cl_crosshair_dynamic_maxdist_splitratio]` | 1 | 内间距 = cl_crosshairsize×(1-cl_crosshair_dynamic_maxdist_splitratio)，外间距 = cl_crosshairsize×cl_crosshair_dynamic_maxdist_splitratio |
| `[mod authors use this]` | 1 | 供 Mod 作者使用 |
| `[near the player]` | 1 | 玩家附近 |
| `[output name]` | 1 | 输出名称 |
| `[within 256 units of the player]` | 1 | 玩家周围 256 单位范围内 |
| `{0=no, 1=yes}` | 1 | 可选值：0 = 否，1 = 是 |
| `{any, CT, T}` | 1 | 可选值：任意 / 反恐精英 / 恐怖分子 |
| `<class name>` | 1 | 类名 |
| `<classname>` | 1 | 类名 |
| `<commit>` | 1 | 提交 |
| `<concept>` | 1 | 概念 |
| `<ct>` | 1 | 反恐精英阵营 |
| `<delay>` | 1 | 延迟时间 |
| `<distance 1024>` | 1 | 距离（默认 1024） |
| `<distance away>` | 1 | 距离 |
| `<effect name>` | 1 | 效果名称 |
| `<exit code>` | 1 | 进程退出码 |
| `<flags 0>` | 1 | 标志位（0 表示关闭） |
| `<flags>` | 1 | 标志位 |
| `<funcname>` | 1 | 函数名 |
| `<globalname>` | 1 | 全局变量名 |
| `<health to lose>` | 1 | 扣除的生命值 |
| `<heuristic #>` | 1 | 启发式编号 |
| `<index>` | 1 | 编号 |
| `<item_name>` | 1 | 物品名称 |
| `<magnitude 0>` | 1 | 强度（0 表示关闭） |
| `<magnitude>` | 1 | 强度 |
| `<N>` | 1 | 数量 |
| `<new entity name>` | 1 | 新的实体名称 |
| `<new_subclass>` | 1 | 新的子类别 |
| `<not_bomber>` | 1 | 非炸弹携带者 |
| `<option:entname>` | 1 | 可选参数：实体名称 |
| `<optional: allangles>` | 1 | 可选参数：allangles（全角度） |
| `<player name or index>` | 1 | 玩家名称或编号 |
| `<Radius>` | 1 | 半径 |
| `<scale 0>` | 1 | 缩放值（0 表示关闭） |
| `<scale factor>` | 1 | 缩放系数 |
| `<scale>` | 1 | 缩放值 |
| `<skill>` | 1 | 技能值（0-100） |
| `<state>` | 1 | 状态 |
| `<substring>` | 1 | 子字符串 |
| `<t>` | 1 | 恐怖分子阵营 |
| `<threshold bytes>` | 1 | 阈值（字节） |
| `<varname>` | 1 | 变量名 |
| `<weapon subclass name>` | 1 | 武器子类别名称 |
| `<weaponclass>` | 1 | 武器类别 |
