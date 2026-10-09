/**
 * 21 个引擎标记的中文标签与说明。
 * 直接内联自冻结的 data/translation/glossary.json（flags / flagOrder 段），
 * 前端不依赖 glossary 文件本身，避免多一次网络请求。
 */

export interface FlagLabel {
  zh: string;
  note: string;
}

export const FLAG_LABELS: Record<string, FlagLabel> = {
  sv: { zh: '服务端', note: '仅在服务器端存在（server）' },
  cl: { zh: '客户端', note: '仅在客户端存在（client）' },
  rep: { zh: '可复制', note: '取值会复制（replicate）到其他机器，客户端能看到服务器的值' },
  cheat: { zh: '作弊', note: '需要服务器开启 sv_cheats 1 才能使用；联机比赛中通常禁用' },
  release: { zh: '正式版', note: '正式版中可用的命令/变量，未被开发分支隐藏' },
  nf: { zh: '不可设为默认', note: '不可写入配置文件当作永久默认值（not in config file）' },
  a: { zh: '存档', note: '会被存档保存（archive），换图/重连后保留' },
  per_user: { zh: '按用户', note: '按每个用户分别保存取值' },
  user: { zh: '用户信息', note: '用户信息类变量（如 SteamID、玩家名）' },
  norecord: { zh: '不录制', note: '不写入 demo 录像' },
  sp: { zh: '单机', note: '仅在单机（singleplayer）模式可用' },
  demo: { zh: 'Demo 录像', note: 'demo 录像播放相关' },
  nolog: { zh: '不记日志', note: '不写入游戏日志' },
  server_can_execute: { zh: '服务端可执行', note: '允许服务器端执行该命令' },
  clientcmd_can_execute: { zh: '客户端可执行', note: '允许客户端执行该命令' },
  vconsole_fuzzy: { zh: '虚拟控制台模糊匹配', note: '虚拟控制台可按模糊关键字匹配' },
  vconsole_set_focus: { zh: '虚拟控制台设焦点', note: '虚拟控制台执行后自动获取焦点' },
  server_cant_query: { zh: '服务端不可查询', note: '服务器无法查询该变量' },
  prot: { zh: '受保护', note: '受保护变量，不允许随意修改' },
  execute_per_tick: { zh: '每帧执行', note: '每个 tick 都会执行一次' },
  disconnected: { zh: '断线可用', note: '断开连接状态下也可使用' },
};

/** 与 glossary.flagOrder 一致：筛选面板按此顺序展示 */
export const FLAG_ORDER: string[] = [
  'sv',
  'cl',
  'rep',
  'cheat',
  'release',
  'nf',
  'a',
  'per_user',
  'user',
  'norecord',
  'sp',
  'demo',
  'nolog',
  'server_can_execute',
  'clientcmd_can_execute',
  'vconsole_fuzzy',
  'vconsole_set_focus',
  'server_cant_query',
  'prot',
  'execute_per_tick',
  'disconnected',
];

export const FLAG_WHITELIST: ReadonlySet<string> = new Set(FLAG_ORDER);

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag]?.zh ?? flag;
}

export function flagTooltip(flag: string): string {
  const entry = FLAG_LABELS[flag];
  return entry ? `${flag} — ${entry.zh}：${entry.note}` : flag;
}

/** 首字母段落；'_' 为 wiki 上的 Cvar_list 等其它分组 */
export const SECTION_ORDER: string[] = ['_', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

export function sectionLabel(section: string): string {
  return section === '_' ? '其它（_）' : section;
}

/** 常用预设：一键「仅显示 cheat / sv / cl」 */
export interface FlagPreset {
  id: string;
  label: string;
  flag: string;
  hint: string;
}

export const FLAG_PRESETS: FlagPreset[] = [
  { id: 'cheat', label: '仅显示作弊', flag: 'cheat', hint: '需要 sv_cheats 1 才能使用' },
  { id: 'sv', label: '仅服务端', flag: 'sv', hint: '只在服务器端存在' },
  { id: 'cl', label: '仅客户端', flag: 'cl', hint: '只在客户端存在' },
  { id: 'release', label: '仅正式版', flag: 'release', hint: '正式版可用，未被开发分支隐藏' },
];
