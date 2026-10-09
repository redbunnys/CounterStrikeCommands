#!/usr/bin/env node
/**
 * tools/prepare-data.mjs — build the frozen dataset + translation work units.
 *
 * Pure Node standard library. No network. Deterministic: running it twice on the
 * same input produces byte-identical outputs (see `GENERATED_AT` below), so it is
 * safe to re-run in CI and offline.
 *
 * INPUT
 *   data/cs2-commands.raw.json   (produced by tools/parse-commands.mjs from data/raw/cs2_wiki.html)
 *
 * OUTPUT
 *   data/commands.json                     canonical dataset (schema frozen, descriptionZh = "")
 *   data/translation/glossary.json         flag labels + bilingual glossary + do-not-translate list
 *   data/translation/README.md             translation contract for the translator agents
 *   data/translation/chunks/chunk-NNN.json translation work units (150 descriptions each)
 *   data/translation/out/                  (created, never wiped) translator output directory
 *   data/prepare-report.txt                build report / evidence
 *
 * RUN MODES (destructive-rerun guard, see the block below the constants)
 *   (default)                 refuses to run if data/commands.json already holds translations
 *   --preserve-translations   carries the existing descriptionZh over (idempotent, write-if-changed)
 *   --reset-translations      resets descriptionZh to "" (then run tools/merge-translations.mjs)
 *
 * DATA REPAIRS (all asserted at build time)
 *   1. wiki placeholder rows (empty letter sections, every cell "N/A") are dropped.
 *   2. four rows whose rendered wiki HTML is corrupt are restored to their true
 *      values. In those rows the wiki renderer consumed the separators inside the
 *      Default Value and re-flowed the remainder into the last cell using the
 *      "&#160;:" run-on marker, e.g. tv_broadcast_url renders as
 *        | tv_broadcast_url | http | //localhost | 8080 : release : URL of the broadcast relay |
 *      The consumed separators cannot be recovered from rendered HTML, so the four
 *      rows are enumerated with their authoritative values (`WIKI_ROW_REPAIRS`);
 *      the flag list and the description of every such row are re-derived
 *      generically from the run-on marker and asserted against the enumeration.
 *   3. `flags` keeps only whitelisted engine flags, original order, de-duplicated.
 *   4. the "Cvar_list" letter section (the wiki's non-alphabetic "_" table) -> "_".
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'cs2-commands.raw.json');
const OUT_DATA = join(ROOT, 'data', 'commands.json');
const REPORT = join(ROOT, 'data', 'prepare-report.txt');
const TX_DIR = join(ROOT, 'data', 'translation');
const CHUNK_DIR = join(TX_DIR, 'chunks');
const OUT_DIR = join(TX_DIR, 'out');

const CHUNK_SIZE = 150;
const SCHEMA_VERSION = 1;
const EXPECTED_COMMANDS = 2528;
/**
 * Dataset freeze timestamp. Fixed on purpose: a rebuild must be byte-identical so
 * that downstream (frontend / translators) can detect real changes only.
 * Override with CS2_GENERATED_AT=<ISO string> when a fresh stamp is wanted.
 */
const GENERATED_AT = process.env.CS2_GENERATED_AT ?? '2026-10-08T14:50:00.000Z';

/* ------------------------------------------------- destructive-rerun guard ----
 * This script RESETS `descriptionZh` to "" by design: the pipeline is
 * `prepare-data` (freeze the dataset) -> `merge-translations` (fill the Chinese).
 * Re-running it on an already merged tree therefore destroys translated, verified
 * data — silently, until t12. The SAFE side is now the default behaviour:
 *
 *   (no flag)                 refuse to run when data/commands.json has translations
 *   --preserve-translations   carry the existing descriptionZh over (idempotent rebuild)
 *   --reset-translations      really reset them, then run tools/merge-translations.mjs
 */
const ARGV = process.argv.slice(2);
const KNOWN_ARGS = ['--preserve-translations', '--reset-translations', '--help', '-h'];
const UNKNOWN_ARGS = ARGV.filter((a) => !KNOWN_ARGS.includes(a));
const PRESERVE_TRANSLATIONS = ARGV.includes('--preserve-translations');
const RESET_TRANSLATIONS = ARGV.includes('--reset-translations');
const USAGE = [
  'usage: node tools/prepare-data.mjs [--preserve-translations | --reset-translations]',
  '',
  '  (no flag)                refuse to run if data/commands.json already holds translations',
  '  --preserve-translations  keep the existing descriptionZh values (idempotent rebuild)',
  '  --reset-translations     reset descriptionZh to "" (then run tools/merge-translations.mjs)',
].join('\n');

if (ARGV.includes('--help') || ARGV.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
if (UNKNOWN_ARGS.length || (PRESERVE_TRANSLATIONS && RESET_TRANSLATIONS)) {
  console.error(`prepare-data: invalid arguments ${JSON.stringify(UNKNOWN_ARGS)}; --preserve-translations and --reset-translations are mutually exclusive.\n\n${USAGE}`);
  process.exit(2);
}

/** Existing dataset (if any) — read *before* anything is written. */
const previousDataset = existsSync(OUT_DATA) ? JSON.parse(readFileSync(OUT_DATA, 'utf8')) : null;
const previousCommands = Array.isArray(previousDataset?.commands) ? previousDataset.commands : [];
const previousTranslated = previousCommands.filter(
  (c) => typeof c.descriptionZh === 'string' && c.descriptionZh.trim() !== ''
);
const previousZhByCommand = new Map(previousCommands.map((c) => [c.command, c]));
const previousTranslationStatus = previousDataset?.meta?.translationStatus ?? null;

if (previousTranslated.length > 0 && !PRESERVE_TRANSLATIONS && !RESET_TRANSLATIONS) {
  const samples = previousTranslated.slice(0, 3).map((c) => c.command).join(', ');
  console.error(
    [
      'prepare-data: REFUSING TO RUN — this would silently destroy merged translations.',
      '',
      `  data/commands.json already holds ${previousTranslated.length} non-empty descriptionZh value(s)`,
      `  (e.g. ${samples}${previousTranslated.length > 3 ? ', …' : ''}).`,
      '',
      '  This script resets descriptionZh to "" by design: the pipeline is',
      '    tools/prepare-data.mjs  ->  tools/merge-translations.mjs  ->  tools/verify-dataset.mjs',
      '  so re-running prepare-data here would wipe translated, already-verified Chinese.',
      '',
      '  Choose explicitly:',
      '    --preserve-translations   keep the existing translations (byte-identical rebuild)',
      '    --reset-translations      really reset them; re-run tools/merge-translations.mjs afterwards',
      '',
      '  Nothing was written.',
    ].join('\n')
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ contract */

/** Engine flag whitelist, in the exact order fixed by the schema contract. */
const FLAG_TABLE = [
  ['sv', '服务端', '仅在服务器端存在（server）'],
  ['cl', '客户端', '仅在客户端存在（client）'],
  ['rep', '可复制', '取值会复制（replicate）到其他机器，客户端能看到服务器的值'],
  ['cheat', '作弊', '需要服务器开启 sv_cheats 1 才能使用；联机比赛中通常禁用'],
  ['release', '正式版', '正式版中可用的命令/变量，未被开发分支隐藏'],
  ['nf', '不可设为默认', '不可写入配置文件当作永久默认值（not in config file）'],
  ['a', '存档', '会被存档保存（archive），换图/重连后保留'],
  ['per_user', '按用户', '按每个用户分别保存取值'],
  ['user', '用户信息', '用户信息类变量（如 SteamID、玩家名）'],
  ['norecord', '不录制', '不写入 demo 录像'],
  ['sp', '单机', '仅在单机（singleplayer）模式可用'],
  ['demo', 'Demo 录像', 'demo 录像播放相关'],
  ['nolog', '不记日志', '不写入游戏日志'],
  ['server_can_execute', '服务端可执行', '允许服务器端执行该命令'],
  ['clientcmd_can_execute', '客户端可执行', '允许客户端执行该命令'],
  ['vconsole_fuzzy', '虚拟控制台模糊匹配', '虚拟控制台可按模糊关键字匹配'],
  ['vconsole_set_focus', '虚拟控制台设焦点', '虚拟控制台执行后自动获取焦点'],
  ['server_cant_query', '服务端不可查询', '服务器无法查询该变量'],
  ['prot', '受保护', '受保护变量，不允许随意修改'],
  ['execute_per_tick', '每帧执行', '每个 tick 都会执行一次'],
  ['disconnected', '断线可用', '断开连接状态下也可使用'],
];
const FLAG_WHITELIST = FLAG_TABLE.map(([f]) => f);
const FLAG_SET = new Set(FLAG_WHITELIST);
const FLAG_LABELS = Object.fromEntries(
  FLAG_TABLE.map(([flag, zh, note]) => [flag, { zh, note }])
);

/**
 * The four rows whose rendered wiki HTML is corrupt (see file header).
 * `defaultValue` is authoritative; `flags`/`description` are asserted against the
 * value re-derived generically from the run-on marker.
 */
const WIKI_ROW_REPAIRS = {
  tv_broadcast_url: {
    defaultValue: 'http://localhost:8080',
    flags: ['release'],
    description: 'URL of the broadcast relay',
    why: 'wiki consumed the ":" separators: default value rendered as `http | //localhost | 8080 …`',
  },
  tv_broadcast_url1: {
    defaultValue: 'http://localhost:8080',
    flags: ['release'],
    description: 'URL of the broadcast relay1',
    why: 'same corruption as tv_broadcast_url',
  },
  cl_promoted_settings_acknowledged: {
    defaultValue: '1696196680965',
    flags: ['cl', 'a'],
    description: '',
    why: 'wiki spilled the default value into the Flags column and the flag list into the Description column',
  },
  sv_mapvetopickvote_phase_duration: {
    defaultValue: '[1 | 5][2 | 15][3:20][4:10][5:10][6:5]',
    flags: ['sv', 'release'],
    description: 'How many seconds each phase lasts',
    why: 'default value contains " | " twice and the wiki split the cells on those pipes',
  },
};

/** The four repaired values, asserted verbatim (regression guard). */
const EXPECTED_REPAIRS = {
  tv_broadcast_url: 'http://localhost:8080',
  tv_broadcast_url1: 'http://localhost:8080',
  cl_promoted_settings_acknowledged: '1696196680965',
  sv_mapvetopickvote_phase_duration: '[1 | 5][2 | 15][3:20][4:10][5:10][6:5]',
};

/* ------------------------------------------------------------ glossary data */

/** Core bilingual terms (en -> zh). Duplicates are rejected at build time. */
const TERM_TABLE = [
  ['convar', '控制台变量'],
  ['console variable', '控制台变量'],
  ['cvar', '控制台变量'],
  ['command', '命令'],
  ['console command', '控制台命令'],
  ['argument', '参数'],
  ['parameter', '参数'],
  ['flag', '标记'],
  ['default', '默认'],
  ['default value', '默认值'],
  ['value', '取值'],
  ['server', '服务器'],
  ['client', '客户端'],
  ['server-side', '服务器侧'],
  ['client-side', '客户端侧'],
  ['host', '主机'],
  ['listen server', '本地服务器（listen server）'],
  ['dedicated server', '专用服务器'],
  ['server operator', '服务器管理员'],
  ['player', '玩家'],
  ['bot', '机器人'],
  ['spectator', '观战者'],
  ['spectating', '观战'],
  ['team', '队伍'],
  ['Terrorist', '恐怖分子'],
  ['Counter-Terrorist', '反恐精英'],
  ['round', '回合'],
  ['round time', '回合时长'],
  ['freeze time', '冻结时间'],
  ['buy time', '购买时间'],
  ['warmup', '热身'],
  ['halftime', '半场'],
  ['overtime', '加时'],
  ['match point', '赛点'],
  ['scoreboard', '计分板'],
  ['matchmaking', '匹配'],
  ['competitive', '竞技模式'],
  ['Premier', 'Premier 模式'],
  ['Wingman', '双人模式'],
  ['casual', '休闲模式'],
  ['deathmatch', '死斗模式'],
  ['Arms Race', '军备竞赛'],
  ['Demolition', '爆破模式'],
  ['Guardian', '守护模式'],
  ['Retake', '夺回模式'],
  ['hostage', '人质'],
  ['rescue', '解救'],
  ['bomb', '炸弹'],
  ['bomb site', '包点'],
  ['plant', '下包'],
  ['defuse', '拆包'],
  ['defuse kit', '拆弹器'],
  ['economy', '经济'],
  ['money', '金钱'],
  ['buy menu', '购买菜单'],
  ['loadout', '装备配置'],
  ['armor', '护甲'],
  ['helmet', '头盔'],
  ['kevlar', '防弹衣'],
  ['health', '生命值'],
  ['damage', '伤害'],
  ['friendly fire', '友军伤害'],
  ['hitbox', '命中判定盒'],
  ['headshot', '爆头'],
  ['wallbang', '穿墙击杀'],
  ['spray', '扫射'],
  ['recoil', '后坐力'],
  ['spread', '弹道散布'],
  ['accuracy', '精准度'],
  ['ammo', '弹药'],
  ['magazine', '弹匣'],
  ['reload', '换弹'],
  ['weapon', '武器'],
  ['grenade', '投掷物'],
  ['smoke grenade', '烟雾弹'],
  ['flashbang', '闪光弹'],
  ['high explosive grenade', '高爆手雷'],
  ['molotov', '燃烧瓶'],
  ['incendiary grenade', '燃烧弹'],
  ['decoy', '诱饵弹'],
  ['spawn', '出生点'],
  ['respawn', '重生'],
  ['entity', '实体'],
  ['prop', '物件'],
  ['physics', '物理'],
  ['collision', '碰撞'],
  ['trace', '射线检测'],
  ['navmesh', '寻路网格'],
  ['nav', '寻路'],
  ['map', '地图'],
  ['workshop', '创意工坊'],
  ['demo', '录像（demo）'],
  ['replay', '回放'],
  ['broadcast', '转播'],
  ['GOTV', 'GOTV'],
  ['SourceTV', 'SourceTV'],
  ['tick', 'tick'],
  ['tickrate', 'tick 频率'],
  ['subtick', 'subtick'],
  ['fps', '帧率'],
  ['frame', '帧'],
  ['latency', '延迟'],
  ['ping', '延迟'],
  ['packet', '数据包'],
  ['bandwidth', '带宽'],
  ['rate', '传输速率'],
  ['prediction', '预测'],
  ['interpolation', '插值'],
  ['lag compensation', '延迟补偿'],
  ['crosshair', '准星'],
  ['viewmodel', '持枪视角'],
  ['fov', '视野范围'],
  ['sensitivity', '灵敏度'],
  ['mouse acceleration', '鼠标加速'],
  ['raw input', '原始输入'],
  ['hud', 'HUD'],
  ['overlay', '叠加层'],
  ['radar', '雷达'],
  ['volume', '音量'],
  ['sound', '音效'],
  ['soundscape', '环境音'],
  ['voice', '语音'],
  ['microphone', '麦克风'],
  ['particle', '粒子'],
  ['material', '材质'],
  ['texture', '贴图'],
  ['shader', '着色器'],
  ['render', '渲染'],
  ['shadow', '阴影'],
  ['lightmap', '光照贴图'],
  ['lod', '细节层级'],
  ['model', '模型'],
  ['animation', '动画'],
  ['debug', '调试'],
  ['log', '日志'],
  ['logging', '日志记录'],
  ['metrics', '指标'],
  ['performance', '性能'],
  ['memory', '内存'],
  ['cheat', '作弊'],
  ['cheat protected', '作弊保护'],
  ['vote', '投票'],
  ['kick', '踢出'],
  ['ban', '封禁'],
  ['timeout', '技术暂停'],
  ['pause', '暂停'],
  ['unpause', '取消暂停'],
  ['settings', '设置'],
  ['config', '配置文件'],
  ['alias', '别名'],
  ['bind', '绑定'],
  ['keybind', '按键绑定'],
  ['execute', '执行'],
  ['restart', '重启'],
  ['map change', '换图'],
  ['replicated', '复制同步'],
  ['cheat flag', '作弊标记'],
  // --- 第 1/2 批翻译统一译法补充（由 translator 提出，captain 核对；不要改动上面已有条目的含义） ---
  ['dogtag', '狗牌'],
  ['dog tags', '狗牌'],
  ['tagging', '黏滞（tagging）'],
  ['sticky', '黏滞（tagging）'],
  ['War Games', '战争游戏'],
  ['hostage rescue', '人质救援模式'],
  ['overtake', '包点夺回'],
  ['overdraw', '过度绘制'],
  ['overscan', '过扫描'],
  ['sequencer', '编曲器'],
  ['arrangement', '编曲'],
  ['sampler', '采样器'],
  ['foliage', '植被'],
  ['clan tag', '队标'],
  ['metallic', '金属度'],
  ['roughness', '粗糙度'],
  ['reflectance', '反射率'],
  ['texture streaming', '贴图流送'],
  ['collision group', '碰撞组'],
  ['bonus time', '奖励时间'],
  ['team bonus', '缺人补助'],
  ['shortage', '缺人补助'],
];

/**
 * Source defects: descriptions that are already broken ON THE WIKI (missing
 * brackets, stray spaces, typos). They are logged in meta.sourceDefects so that
 * (a) translators keep the broken form verbatim instead of silently "fixing" it,
 * and (b) reviewers never report them as translation defects.
 * Every rule below is deterministic and re-derived on each build; hits are
 * recomputed independently by tools/verify-dataset.mjs, which fails if a hit is
 * not registered here (no silent pass-through).
 */
const SOURCE_DEFECT_RULES = [
  {
    id: 'unbalanced-bracket',
    zh: '括号不闭合/不配对',
    detect(text) {
      const out = [];
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        const a = (text.match(new RegExp(`\\${open}`, 'g')) ?? []).length;
        const b = (text.match(new RegExp(`\\${close}`, 'g')) ?? []).length;
        if (a !== b) out.push(`${open}×${a}、${close}×${b}`);
      }
      return out.length ? out.join('；') : null;
    },
  },
  {
    id: 'spacing-inside-parens',
    zh: '括号内侧多余空格',
    detect: (text) => {
      const m = text.match(/\(\s|\s\)/);
      return m ? JSON.stringify(m[0]) : null;
    },
  },
  {
    id: 'possessive-s',
    zh: "所有格错误（…s's）",
    detect: (text) => {
      const m = text.match(/\b[A-Za-z]{2,}s's\b/);
      return m ? m[0] : null;
    },
  },
  {
    id: 'duplicate-word',
    zh: '单词重复',
    detect: (text) => {
      const m = text.match(/\b([A-Za-z]{2,})\s+\1\b/i);
      return m ? m[0] : null;
    },
  },
  {
    id: 'missing-space-after-sentence',
    zh: '句末句号后缺空格',
    detect: (text) => {
      const m = text.match(/[a-z]\.[A-Z][a-z]/);
      return m ? m[0] : null;
    },
  },
  {
    id: 'duplicate-punctuation',
    zh: '标点重复（.. ；不含省略号与 C++ :: 作用域）',
    detect: (text) => {
      const m = text.match(/(?<!\.)\.\.(?!\.)/);
      return m ? m[0] : null;
    },
  },
  {
    id: 'double-space',
    zh: '连续两个空格',
    detect: (text) => (/  /.test(text) ? '2+ spaces' : null),
  },
  {
    id: 'unbalanced-double-quote',
    zh: '双引号数量为奇数',
    detect: (text) => ((text.match(/"/g) ?? []).length % 2 === 1 ? 'odd count' : null),
  },
];

/** The five defects reported by the translator; asserted verbatim on every build. */
const EXPECTED_SOURCE_DEFECTS = {
  805: 'Vertical offset for drawing the mesh (useful for flat planes where the mesh is often a fixed offset from the physical ground',
  908: 'Flow through spawn groups for vis (0 == default, 1 == always visible, 2 == never visible.',
  1008: "Changes's player's model",
  864: "this is the public facing ip address string: ('x.x.x.x' )",
  898: 'Play a recorded demo file (.dem ).',
};

/** Tokens that must survive translation untouched. */
const DO_NOT_TRANSLATE = {  identifiers:
    '控制台标识符一律保持原样：sv_*、cl_*、mp_*、tv_*、host_*、r_*、dsp_*、func_*、weapon_*、item_*、以及以 "+" / "-" 开头的命令（如 +attack、-jump）。',
  placeholders:
    '参数占位符保持原样：{...}、<...>、%s / %1、以及形如 <player>、<index>、<entity_name> 的尖括号参数。',
  values:
    '取值枚举保持原样：0、1、2、true、false、on、off、cmd、default、-1、浮点数与单位（秒/毫秒/像素）。',
  paths: '资源路径与文件名保持原样：de_dust2、cs_office、*.vpk、particles/…、sound/…。',
  acronyms:
    '技术缩写保留英文：HUD、FPS、LOD、GOTV、SourceTV、demo、tick、subtick、nav、NPC、FOV、CPU、GPU、VRAM、URL、HTTP、TCP、UDP、IP、Steam、SteamID、CS2、Counter-Strike、Premier、Wingman。',
};

/* ------------------------------------------------------------------- helpers */

const failures = [];
const checks = [];
function check(ok, label) {
  checks.push({ ok: !!ok, label });
  if (!ok) failures.push(label);
  return !!ok;
}
function assertEqual(actual, expected, label) {
  return check(
    Object.is(actual, expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  );
}
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Split text on the wiki run-on marker " : " (entity &#160; + colon + optional
 * whitespace, collapsed by the parser) and return the lossless parts plus
 * separator offsets. A trailing marker (empty last field) is handled too.
 */
function splitRunOn(text) {
  const re = /\s+:\s*/g;
  const seps = [];
  let m;
  while ((m = re.exec(text)) !== null) seps.push([m.index, m.index + m[0].length]);
  const parts = [];
  let prev = 0;
  for (const [s, e] of seps) {
    parts.push(text.slice(prev, s));
    prev = e;
  }
  parts.push(text.slice(prev));
  return { parts, seps };
}

const flagList = (text) =>
  text
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

/* --------------------------------------------------------------- build steps */

const rawBuf = readFileSync(RAW);
const raw = JSON.parse(rawBuf.toString('utf8'));
check(Array.isArray(raw.commands) && raw.commands.length > 0, 'raw input contains commands');
check(!!raw.summary && !!raw.summary.source, 'raw input carries source metadata');

const droppedPlaceholders = [];
const repairedRows = [];
const unknownFlagTokens = [];
const unhandledRunOnRows = [];
const misalignedRows = [];
const translationsNotCarried = [];
let carriedTranslations = 0;
const seenCommands = new Set();
const commands = [];

for (const rec of raw.commands) {
  const command = String(rec.command ?? '').trim();
  const flagsIn = Array.isArray(rec.flags) ? rec.flags.map((f) => String(f).trim()) : [];
  let defaultValue = rec.defaultValue === null || rec.defaultValue === undefined ? null : String(rec.defaultValue);
  let descriptionEn = String(rec.description ?? '').trim();
  let flags = flagsIn;

  // (1) drop the wiki's placeholder rows for empty letter sections.
  const isPlaceholder =
    command === 'N/A' ||
    (defaultValue === 'N/A' && descriptionEn === 'N/A' && flags.every((f) => f === 'N/A'));
  if (isPlaceholder) {
    droppedPlaceholders.push({ command, section: rec.section });
    continue;
  }

  // (1b) MISALIGNMENT GUARD — deliberately orthogonal to criterion A (the `&#160;:`
  //      marker in the HTML) and criterion B (non-whitelisted flag tokens). The wiki
  //      template is `Command | Default Value | Flags | Description`; when a row's
  //      fields shift one column left, a *flag token* ends up in the Default Value
  //      cell (or the whole value ends up duplicated in the Flags cell). A real
  //      default value can be neither, so this catches corrupt rows that carry no
  //      nbsp marker and whose Flags cell happens to hold only whitelisted flags.
  const rawDefault = defaultValue === null ? '' : String(defaultValue).trim();
  const normaliseCell = (text) => text.split(',').map((s) => s.trim()).filter(Boolean).join(',');
  const misalignment = [];
  if (rawDefault !== '' && FLAG_SET.has(rawDefault.toLowerCase())) {
    misalignment.push(`defaultValue ${JSON.stringify(rawDefault)} is a bare engine-flag token`);
  }
  if (rawDefault !== '' && normaliseCell(rawDefault) === normaliseCell(flagsIn.join(','))) {
    misalignment.push('defaultValue is identical to the Flags cell');
  }
  if (misalignment.length) {
    misalignedRows.push({
      command,
      defaultValue: rec.defaultValue,
      flags: flagsIn,
      description: descriptionEn,
      reason: misalignment.join('; '),
    });
  }

  // (2) corrupt rendered rows: the wiki squeezes "<leftover value> : <flags> : <description>"
  //     into the Flags/Description columns, using "&#160;:" as the separator. After the
  //     parser collapsed whitespace the marker shows up as " : " inside the description.
  //     Detection is deliberately independent of the flag whitelist (a run-on row is also
  //     detected when its synthesized flag list parses cleanly), so a *new* corrupt row can
  //     never slip through silently — it fails the build unless it is enumerated.
  //     NB: prose rows such as `changelevel <mapname> :Multiplayer change level.` share the
  //     " : " shape but sit on a plain space, not on the wiki's `&#160;` marker; the
  //     authoritative HTML-level audit lives in tools/verify-dataset.mjs.
  const badFlags = flags.filter((f) => !FLAG_SET.has(f));
  const runOn = splitRunOn(descriptionEn);
  const runOnFlags = runOn.seps.length
    ? flagList(runOn.parts[runOn.parts.length - 2] ?? '').filter((f) => FLAG_SET.has(f))
    : [];
  const isRunOnRow = runOn.seps.length > 0 && (badFlags.length > 0 || runOnFlags.length > 0);
  if (isRunOnRow) {
    const repair = WIKI_ROW_REPAIRS[command];
    check(!!repair, `run-on row ${command} is enumerated in WIKI_ROW_REPAIRS`);
    if (repair) {
      // The flags and the description are re-derived generically from the last two
      // run-on segments and asserted against the enumeration; only the default
      // value (whose separators the wiki consumed) comes from the enumeration.
      const segments = runOn.parts;
      const derivedFlags = flagList(segments[segments.length - 2] ?? '');
      const derivedDesc = segments[segments.length - 1];
      assertEqual(derivedFlags.join(','), repair.flags.join(','), `generic flags of ${command}`);
      assertEqual(derivedDesc, repair.description, `generic description of ${command}`);
      // original (broken) cell contents, kept for traceability in meta.repairedRows
      const wikiCells = {
        command,
        defaultValue: rec.defaultValue === null || rec.defaultValue === undefined ? null : String(rec.defaultValue),
        flags: flagsIn.join(', '),
        description: String(rec.description ?? '').trim(),
      };
      defaultValue = repair.defaultValue;
      flags = repair.flags;
      descriptionEn = repair.description;
      repairedRows.push({
        command,
        section: rec.section === 'Cvar_list' ? '_' : String(rec.section ?? '').trim(),
        wikiCells,
        restored: {
          defaultValue: repair.defaultValue,
          flags: [...repair.flags],
          descriptionEn: repair.description,
        },
        why: repair.why,
      });
    } else {
      unhandledRunOnRows.push({ command, wikiCells: { defaultValue, flags: flags.join(', '), description: descriptionEn } });
      unknownFlagTokens.push({ command, tokens: badFlags });
    }
  } else if (badFlags.length) {
    unknownFlagTokens.push({ command, tokens: badFlags });
  }

  // (3) flags: whitelist only, original order, de-duplicated.
  const knownFlags = [...new Set(flags.filter((f) => FLAG_SET.has(f)))];
  const section = rec.section === 'Cvar_list' ? '_' : String(rec.section ?? '').trim();

  check(!seenCommands.has(command), `command ${command} is unique`);
  seenCommands.add(command);

  // (5) preserve mode: carry the existing translation over when the English text is
  //     unchanged, so a rebuild on a merged tree is byte-identical instead of destructive.
  let descriptionZh = '';
  if (PRESERVE_TRANSLATIONS) {
    const previous = previousZhByCommand.get(command);
    if (previous && previous.descriptionEn === descriptionEn && typeof previous.descriptionZh === 'string' && previous.descriptionZh !== '') {
      descriptionZh = previous.descriptionZh;
      carriedTranslations++;
    } else if (previous && previous.descriptionZh) {
      translationsNotCarried.push(command);
    }
  }

  commands.push({
    id: 0, // assigned after sorting
    command,
    defaultValue,
    flags: knownFlags,
    descriptionEn,
    descriptionZh,
    section,
  });
}

// enumerations that must all have been exercised
for (const cmd of Object.keys(WIKI_ROW_REPAIRS)) {
  check(repairedRows.some((r) => r.command === cmd), `repair applied to ${cmd}`);
}
assertEqual(
  repairedRows.length,
  Object.keys(WIKI_ROW_REPAIRS).length,
  'number of repaired rows === number of enumerated repairs'
);
check(
  unknownFlagTokens.length === 0,
  `no unknown flag tokens left behind${unknownFlagTokens.length ? `: ${unknownFlagTokens.map((u) => `${u.command}[${u.tokens}]`).join(', ')}` : ''}`
);
check(
  unhandledRunOnRows.length === 0,
  `every corrupt run-on row has an enumerated repair${unhandledRunOnRows.length ? `: ${unhandledRunOnRows.map((u) => u.command).join(', ')}` : ''}`
);
check(
  misalignedRows.length === 0,
  `no misaligned row (bare engine-flag token as Default Value / value duplicated into the Flags cell)${
    misalignedRows.length
      ? `: ${misalignedRows.map((r) => `${r.command}(defaultValue=${JSON.stringify(r.defaultValue)} flags=[${r.flags.join(', ')}] ${r.reason})`).join('; ')}`
      : ''
  }`
);
check(droppedPlaceholders.length === 2, `2 placeholder rows dropped (got ${droppedPlaceholders.length})`);

// (4) canonical order: alphabetical by command, ids 1..N
commands.sort((a, b) => (a.command < b.command ? -1 : a.command > b.command ? 1 : 0));
commands.forEach((c, i) => (c.id = i + 1));

assertEqual(commands.length, EXPECTED_COMMANDS, 'commands.length');
check(
  commands.every((c) => /^[A-Z_]$/.test(c.section)),
  'every section is a letter A-Z or "_"'
);
check(
  commands.every((c) => c.flags.every((f) => FLAG_SET.has(f))),
  'every emitted flag is whitelisted'
);
check(
  commands.every((c) => new Set(c.flags).size === c.flags.length),
  'no duplicate flags within a row'
);
if (PRESERVE_TRANSLATIONS) {
  check(
    translationsNotCarried.length === 0,
    `preserve mode carried every existing translation (kept ${carriedTranslations}, dropped ${translationsNotCarried.length})${translationsNotCarried.length ? `: ${translationsNotCarried.slice(0, 5).join(', ')}` : ''}`
  );
  assertEqual(carriedTranslations, previousTranslated.length, 'preserve mode kept the same number of translations as before');
} else {
  check(
    commands.every((c) => c.descriptionZh === ''),
    'descriptionZh is empty at this stage'
  );
}
for (const [cmd, expected] of Object.entries(EXPECTED_REPAIRS)) {
  const row = commands.find((c) => c.command === cmd);
  assertEqual(row ? row.defaultValue : null, expected, `repaired default value of ${cmd}`);
}

/* ------------------------------------------- source-defect ledger (wiki-side) */

const uniqueDescriptions = [];
const descriptionIndex = new Map();
for (const c of commands) {
  if (!c.descriptionEn) continue;
  if (!descriptionIndex.has(c.descriptionEn)) {
    descriptionIndex.set(c.descriptionEn, uniqueDescriptions.length);
    uniqueDescriptions.push(c.descriptionEn);
  }
}
const withEnglishDescription = commands.filter((c) => c.descriptionEn).length;

check(
  commands.every((c) => !c.descriptionEn || descriptionIndex.has(c.descriptionEn)),
  'every non-empty descriptionEn is addressable in the description index'
);
check(
  new Set(uniqueDescriptions).size === uniqueDescriptions.length,
  'unique descriptions are de-duplicated'
);

const sourceDefectEntries = [];
for (let index = 0; index < uniqueDescriptions.length; index++) {
  const text = uniqueDescriptions[index];
  for (const rule of SOURCE_DEFECT_RULES) {
    const detail = rule.detect(text);
    if (detail !== null && detail !== undefined) {
      sourceDefectEntries.push({
        index,
        descriptionEn: text,
        type: rule.id,
        typeZh: rule.zh,
        detail: String(detail),
      });
    }
  }
}
const defectByType = {};
for (const e of sourceDefectEntries) defectByType[e.type] = (defectByType[e.type] ?? 0) + 1;

// the five defects reported by the translator must all be present, verbatim
for (const [idx, snippet] of Object.entries(EXPECTED_SOURCE_DEFECTS)) {
  const hit = sourceDefectEntries.find((e) => e.index === Number(idx));
  check(
    !!hit && hit.descriptionEn.includes(snippet) && hit.descriptionEn === uniqueDescriptions[Number(idx)],
    `source defect at description index ${idx} is registered verbatim`
  );
}
check(sourceDefectEntries.length >= 5, `source-defect ledger has >= 5 entries (got ${sourceDefectEntries.length})`);
check(
  new Set(sourceDefectEntries.map((e) => `${e.index}|${e.type}`)).size === sourceDefectEntries.length,
  'no duplicate (index, type) source-defect entries'
);
check(
  sourceDefectEntries.every((e) => uniqueDescriptions[e.index] === e.descriptionEn),
  'every source-defect entry resolves to its chunk description index'
);

const sourceDefects = {
  note: '原文（Valve wiki）自身残缺/笔误的英文描述清单，按全局描述索引登记。翻译时必须逐字保留原文的残缺形态，不得自行修正；校验时不得把这些判为 translation 缺陷。',
  policy:
    'translator：按原文残缺形态翻译（例如缺失的右括号、多余空格、Changes\'s 这类所有格错误，保持同样的残缺，不做补全/纠正）。verifier：本清单内的索引不得报为翻译缺陷（needs_revision）。',
  detectors: SOURCE_DEFECT_RULES.map((r) => ({ id: r.id, zh: r.zh, hits: defectByType[r.id] ?? 0 })),
  count: sourceDefectEntries.length,
  byType: defectByType,
  mergeReportHint:
    'merge 阶段必须把本清单原样收进 merge-report（index / descriptionEn / type / typeZh / detail 五项齐全），供 verifier 与交付说明引用；verifier 不得把这些索引判为翻译缺陷。',
  entries: sourceDefectEntries,
};

/* ---------------------------------------------------- translation work units */

const chunks = [];
mkdirSync(CHUNK_DIR, { recursive: true });
const chunkRewritten = [];
const staleChunksRemoved = [];

for (let start = 0; start < uniqueDescriptions.length; start += CHUNK_SIZE) {
  const descriptions = uniqueDescriptions.slice(start, start + CHUNK_SIZE);
  const indices = descriptions.map((_, i) => start + i);
  const name = `chunk-${String(chunks.length + 1).padStart(3, '0')}`;
  const file = join(CHUNK_DIR, `${name}.json`);
  const content = JSON.stringify({ chunk: name, indices, descriptions }, null, 2) + '\n';
  // write-if-changed: a rebuild must never touch a work unit the translator is using
  if (!existsSync(file) || readFileSync(file, 'utf8') !== content) {
    writeFileSync(file, content, 'utf8');
    chunkRewritten.push(name);
  }
  chunks.push({
    chunk: name,
    count: descriptions.length,
    firstIndex: start,
    lastIndex: start + descriptions.length - 1,
    file: `data/translation/chunks/${name}.json`,
  });
}
const plannedChunks = new Set(chunks.map((c) => `${c.chunk}.json`));
for (const f of readdirSync(CHUNK_DIR)) {
  if (/^chunk-\d{3}\.json$/.test(f) && !plannedChunks.has(f)) {
    rmSync(join(CHUNK_DIR, f));
    staleChunksRemoved.push(f);
  }
}
check(
  chunkRewritten.length === 0 || chunkRewritten.every((n) => plannedChunks.has(`${n}.json`)),
  'chunk work units are written idempotently (write-if-changed)'
);

// continuity: 0-based, ascending, unique, gapless, non-overlapping across chunks
const flatIndices = chunks.flatMap((c, i) =>
  Array.from({ length: c.count }, (_, k) => c.firstIndex + k)
);
assertEqual(flatIndices.length, uniqueDescriptions.length, 'index count === unique description count');
check(
  flatIndices.length === 0 || flatIndices[flatIndices.length - 1] + 1 === flatIndices.length,
  'description indices are contiguous from 0'
);
check(
  flatIndices.every((v, i) => v === i),
  'description indices are ascending, unique and gapless across chunks'
);

/* -------------------------------------------------------- glossary and readme */

const glossary = {
  meta: {
    generatedBy: 'tools/prepare-data.mjs',
    generatedAt: GENERATED_AT,
    locale: 'zh-CN',
    note: 'CS2 控制台术语中英对照。本次生成的 flag 名称、术语与不译清单是翻译一致性的唯一基准；translator 必须复用这些译法。',
  },
  flags: FLAG_LABELS,
  flagOrder: FLAG_WHITELIST,
  terms: Object.fromEntries(TERM_TABLE),
  doNotTranslate: DO_NOT_TRANSLATE,
  valueTokens: {
    '0': '关闭 / 禁用',
    '1': '开启 / 启用',
    true: 'true（开启）',
    false: 'false（关闭）',
    '-1': '-1（通常表示不限制/自动）',
    cmd: 'cmd（该条是命令而不是变量）',
  },
};

check(
  Object.keys(FLAG_LABELS).length === 21 && FLAG_WHITELIST.length === 21,
  'glossary covers all 21 engine flags'
);
check(
  Object.values(FLAG_LABELS).every((v) => v.zh && v.note),
  'every flag has a Chinese name and a human-readable note'
);
check(
  new Set(TERM_TABLE.map(([en]) => en)).size === TERM_TABLE.length,
  'glossary terms are unique'
);
check(TERM_TABLE.length >= 60, `glossary has >= 60 core terms (has ${TERM_TABLE.length})`);

writeFileSync(join(TX_DIR, 'glossary.json'), JSON.stringify(glossary, null, 2) + '\n', 'utf8');

const readme = `# CS2 控制台命令中文翻译规范（v${SCHEMA_VERSION}）

> 本目录由 \`tools/prepare-data.mjs\` 生成，**不要手工修改** \`glossary.json\`、\`chunks/\`；
> 如需增补术语或调整切片，请改脚本后重新运行（脚本幂等、离线可跑）。

## 1. 目标

把 \`data/commands.json\` 中每条命令的 \`descriptionEn\`（英文说明）翻译成简体中文，
由 merge 任务写回对应命令的 \`descriptionZh\`。数据集共 **${commands.length}** 条命令，
其中 **${withEnglishDescription}** 条带英文说明；去重后为 **${uniqueDescriptions.length}** 条唯一说明，
切成 **${chunks.length}** 个工作单元（每单元 ≤ ${CHUNK_SIZE} 条）。

## 2. 输入（只读）

\`data/translation/chunks/chunk-NNN.json\`：

\`\`\`json
{ "chunk": "chunk-001", "indices": [0, 1, 2], "descriptions": ["英文说明 A", "英文说明 B", "英文说明 C"] }
\`\`\`

- \`indices\` 是**全局描述索引**（0 基、升序、全局唯一、跨 chunk 连续无缺口）。
- \`indices[i]\` 对应 \`descriptions[i]\`，两者等长。

## 3. 输出（必须严格遵守）

\`data/translation/out/chunk-NNN.json\`，文件名与输入 chunk 一一对应：

\`\`\`json
{
  "chunk": "chunk-001",
  "entries": {
    "0": "把英文说明 A 翻译成中文",
    "1": "把英文说明 B 翻译成中文",
    "2": "把英文说明 C 翻译成中文"
  }
}
\`\`\`

## 4. 硬性约束（verify 会逐条检查）

1. \`entries\` 的 key 集合必须与该 chunk 的 \`indices\` **完全一致**：不多、不少、不重。
2. key 是**字符串形式的十进制索引**（\`"0"\`、\`"137"\`），不是数组下标、不是对象。
3. 每条译文必须是**非空字符串**，且至少包含一个 CJK 汉字；不允许留空、不允许占位符 (\`TODO\`/\`TBD\`)。
4. 不允许整条照抄英文：必须给出中文表述（专有名词可保留原文，见第 6 节）。
5. 只写 \`data/translation/out/<自己的 chunk>.json\`；**不要改** \`data/commands.json\`、\`chunks/\`、\`glossary.json\`。
6. 译文内不要出现换行符；首尾不要有多余空格。
7. 不添加原文没有的功能、数值或限制；不省略原文的限制条件与默认取值说明。
8. 一条原文对应一条译文，保持 \`indices\` 与 \`descriptions\` 的位置关系，不要合并或拆分条目。

## 5. 风格约定

- 面向 CS2 玩家与服务器管理员，简明直白。
- 命令类描述用动词开头：\`显示…\`、\`开启…\`、\`设置…\`、\`打印…\`、\`切换…\`。
- 变量类描述说明"这个变量控制什么"，必要时补一句取值含义。
- 取值枚举保留数字与语义：\`0 = off, 1 = on\` → \`0 = 关闭，1 = 开启\`。
- 中文用全角标点（，、。；：），但标识符、数字、单位、路径内一律保持半角原样。
- 句末一般不加句号；原文明显是完整句子时可保留中文句号。
- 括号统一用全角\`（）\`；但占位符与函数式写法保持原样（如 \`func_door(open)\`）。
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

- **标识符**：${DO_NOT_TRANSLATE.identifiers}
- **占位符**：${DO_NOT_TRANSLATE.placeholders}
- **取值**：${DO_NOT_TRANSLATE.values}
- **路径/资源名**：${DO_NOT_TRANSLATE.paths}
- **技术缩写**：${DO_NOT_TRANSLATE.acronyms}

## 7. 一致性

先读 \`data/translation/glossary.json\`：\`flags\`（21 个引擎标记的中文名与说明）、
\`terms\`（${TERM_TABLE.length} 条核心术语）、\`doNotTranslate\`、\`valueTokens\`。
同一英文词在同一批译文里必须用同一译法；术语表里没有的词，按第 5 节风格自定，并在交付说明里列出。

## 8. 提交前自检

\`\`\`bash
node -e "const c=require('./data/translation/chunks/chunk-001.json');const o=require('./data/translation/out/chunk-001.json');\\
const a=c.indices.map(String).sort().join(',');const b=Object.keys(o.entries).sort().join(',');\\
console.log(a===b?'keys OK':'KEYS MISMATCH');console.log(Object.values(o.entries).every(v=>/[\\\\u4e00-\\\\u9fff]/.test(v))?'CJK OK':'CJK MISSING')"
\`\`\`

## 9. 数据溯源与已知修复

- \`data/commands.json.meta.repairedRows\`：**4 条** wiki 渲染损坏行，逐条给出「原始单元格内容 →
  还原后字段」。现有 4 条为 \`tv_broadcast_url\`、\`tv_broadcast_url1\`、
  \`cl_promoted_settings_acknowledged\`、\`sv_mapvetopickvote_phase_duration\`；其 \`descriptionEn\`
  已按还原后的英文原文给出，翻译时直接按该英文处理即可。
- \`data/commands.json.meta.droppedPlaceholderRows\`：2 条空字母段落（X、Y）的 N/A 占位行，已丢弃。
- \`node tools/verify-dataset.mjs\` 会独立扫描 \`data/raw/cs2_wiki.html\`，用两条互不依赖的判据
  （单元格内 \`&#160;\` 紧邻 \`:\`；Flags 列出现非白名单 token）重算损坏行集合，并断言它与
  \`meta.repairedRows\` 完全一致；一旦 wiki 再现同类坏行、或某条修复不再对应源数据，校验会
  **直接失败（exit 1）而不是静默通过**。构建脚本 \`tools/prepare-data.mjs\` 同样会因此失败。
- \`data/translation/chunks/*.json\` 采用 write-if-changed 写入：内容不变时**不会重写文件**
  （字节与 mtime 都保持不动），因此重建数据集不会打断正在进行的翻译工作。

## 10. 源站缺陷台账（\`meta.sourceDefects\`）

有些英文描述**在 wiki 原文里就是残缺的**（括号不闭合、多余空格、\`Changes's\` 这类所有格错误、
单词重复等）。它们**不是**翻译缺陷：

- 翻译时**逐字保留原文的残缺形态**，不要补全括号、不要删除多余空格、不要把 \`Changes's\` 改成
  \`Changes\`——译文只要如实传达原文意思即可，保持同样的残缺。
- 校验/评审时，\`meta.sourceDefects.entries\` 里列出的**描述索引不得判为翻译缺陷**。
- 台账由本脚本按 8 条确定性规则（括号配对、括号内侧空格、复数所有格、单词重复、句号后缺空格、
  标点重复、连续空格、双引号计数）从全部 ${uniqueDescriptions.length} 条唯一描述里重新扫描生成；
  \`tools/verify-dataset.mjs\` 会独立复算并断言「扫描到的缺陷必须全部登记」，未登记即失败。

## 11. 数据流水线（顺序不可颠倒）

**语义（务必记住）**：\`prepare-data\` 负责**重置**译文，\`merge-translations\` 负责**回填**译文。
所以重跑的正确顺序永远是 \`prepare-data\` → \`merge-translations\` → \`verify-dataset\`。

\`\`\`bash
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
\`\`\`

⚠️ 在**已合并**的树上直接执行 \`node tools/prepare-data.mjs\`（无开关）会**拒绝运行**（exit 1，
且不写任何文件）——因为那会静默抹掉全部译文。

### 安全开关（防止静默丢译文）

\`\`\`bash
node tools/prepare-data.mjs                          # 已合并的树：直接报错退出，提示如何继续
node tools/prepare-data.mjs --preserve-translations  # 保留现有译文（可字节一致地重建）
node tools/prepare-data.mjs --reset-translations     # 明确同意重置，之后必须再跑 merge
node tools/prepare-data.mjs --help                   # 用法
\`\`\`

- **默认（无开关）= 安全的那一侧**：检测到 \`data/commands.json\` 里已有非空 \`descriptionZh\` 就退出，
  并报出条数与示例命令，绝不静默抹掉译文。
- \`--preserve-translations\`：按命令把已有译文回填（仅当该条 \`descriptionEn\` 未变），
  \`commands.json\` 也是 write-if-changed 写入——因此内容不变时**连 mtime 都不动**。
- \`--reset-translations\`：真正执行重置；**必须**紧接着跑 \`tools/merge-translations.mjs\`。
- \`tools/guard-selftest.mjs\` 里有对应的负向测试（\`merged-refuse\` / \`merged-preserve\` /
  \`clean-default-run\` / \`roundtrip\`），可随时复跑验证。

- 三个脚本都幂等、离线可跑；重复执行产物字节一致。
- \`prepare-data.mjs\` **不会**触碰 \`data/translation/out/\`（译者产物），且 chunk 文件是 write-if-changed
  写入的——所以重跑它不会打断翻译进度。
`;

writeFileSync(join(TX_DIR, 'README.md'), readme, 'utf8');

// translator output directory must exist and must never be wiped by a rebuild
mkdirSync(OUT_DIR, { recursive: true });
if (!existsSync(join(OUT_DIR, '.gitkeep'))) {
  writeFileSync(join(OUT_DIR, '.gitkeep'), '', 'utf8');
}
check(existsSync(OUT_DIR), 'data/translation/out/ exists');

/* ------------------------------------------------------------------- dataset */

const flagFrequency = {};
for (const c of commands) for (const f of c.flags) flagFrequency[f] = (flagFrequency[f] ?? 0) + 1;

const meta = {
  schemaVersion: SCHEMA_VERSION,
  source: raw.summary.source,
  sourceRetrieved: raw.summary.sourceRetrieved,
  sourceBuild: raw.summary.sourceBuild,
  sourceFile: 'data/raw/cs2_wiki.html',
  sourceSha256: sha256(readFileSync(join(ROOT, 'data', 'raw', 'cs2_wiki.html'))),
  generatedAt: GENERATED_AT,
  generatedBy: 'tools/prepare-data.mjs',
  commands: commands.length,
  withEnglishDescription,
  uniqueEnglishDescriptions: uniqueDescriptions.length,
  chunks: chunks.length,
  chunkSize: CHUNK_SIZE,
  chunkRanges: chunks,
  chunkFilesRewritten: chunkRewritten,
  staleChunkFilesRemoved: staleChunksRemoved,
  emptyEnglishDescriptions: commands.length - withEnglishDescription,
  sections: [...new Set(commands.map((c) => c.section))].sort(),
  flags: FLAG_WHITELIST,
  flagFrequency,
  defaultValueCmd: commands.filter((c) => c.defaultValue === 'cmd').length,
  defaultValueNull: commands.filter((c) => c.defaultValue === null).length,
  droppedPlaceholderRows: droppedPlaceholders,
  repairedRows,
  sourceDefects,
  unknownFlagTokens,
  unhandledRunOnRows,
  translationStatus: PRESERVE_TRANSLATIONS && previousTranslationStatus
    ? previousTranslationStatus
    : {
        descriptionZhFilled: 0,
        outDir: 'data/translation/out',
        workUnits: chunks.length,
      },
};

// write-if-changed: a rebuild with --preserve-translations on an unchanged tree must
// not touch the frozen dataset at all (same bytes, same mtime)
const serialized = JSON.stringify({ meta, commands }, null, 2) + '\n';
const datasetRewritten = !existsSync(OUT_DATA) || readFileSync(OUT_DATA, 'utf8') !== serialized;
if (datasetRewritten) writeFileSync(OUT_DATA, serialized, 'utf8');
check(
  !PRESERVE_TRANSLATIONS || !datasetRewritten || carriedTranslations === 0,
  'preserve mode rewrote commands.json only because the dataset actually changed'
);

/* -------------------------------------------------------------------- report */

const onDisk = JSON.parse(readFileSync(OUT_DATA, 'utf8'));
check(onDisk.commands.length === EXPECTED_COMMANDS, 'commands.json on disk has 2528 commands');
check(onDisk.meta.chunks === chunks.length, 'commands.json meta.chunks matches chunk files');
check(
  JSON.stringify(onDisk.meta.repairedRows.map((r) => r.command).sort()) ===
    JSON.stringify(Object.keys(WIKI_ROW_REPAIRS).sort()),
  'all four wiki row repairs are recorded in meta'
);

const lines = [];
lines.push('CS2 dataset build report (tools/prepare-data.mjs)');
lines.push(`generatedAt        : ${GENERATED_AT}`);
lines.push(`run mode           : ${PRESERVE_TRANSLATIONS ? '--preserve-translations' : RESET_TRANSLATIONS ? '--reset-translations' : 'default (refuses to clobber merged translations)'}`);
lines.push(`translations seen  : ${previousTranslated.length} existing / ${carriedTranslations} carried over`);
lines.push(`dataset rewritten  : ${datasetRewritten}`);
lines.push(`source             : ${raw.summary.source}`);
lines.push(`sourceRetrieved    : ${raw.summary.sourceRetrieved}`);
lines.push(`sourceBuild        : ${raw.summary.sourceBuild}`);
lines.push(`sourceSha256       : ${meta.sourceSha256}`);
lines.push(`commands           : ${commands.length}`);
lines.push(`withEnglishDescription : ${withEnglishDescription}`);
lines.push(`uniqueEnglishDescriptions : ${uniqueDescriptions.length}`);
lines.push(`emptyEnglishDescriptions  : ${commands.length - withEnglishDescription}`);
lines.push(`chunks             : ${chunks.length} (size ${CHUNK_SIZE})`);
lines.push(`sections           : ${meta.sections.join(' ')}`);
lines.push(`defaultValue=cmd   : ${meta.defaultValueCmd}`);
lines.push(`defaultValue=null  : ${meta.defaultValueNull}`);
lines.push('');
lines.push('chunks:');
for (const c of chunks) lines.push(`  ${c.chunk}  idx ${c.firstIndex}-${c.lastIndex}  (${c.count})`);
lines.push('');
lines.push(`chunk work units: ${chunkRewritten.length} rewritten by this run, ${staleChunksRemoved.length} stale removed (write-if-changed)`);
if (chunkRewritten.length) lines.push(`  rewritten: ${chunkRewritten.join(', ')}`);
lines.push('');
lines.push('dropped placeholder rows:');
for (const d of droppedPlaceholders) lines.push(`  ${d.command} (section ${d.section})`);
lines.push('');
lines.push('repaired wiki rows:');
for (const r of repairedRows) {
  lines.push(`  ${r.command}  (section ${r.section})`);
  lines.push(`    wiki cells   : defaultValue=${JSON.stringify(r.wikiCells.defaultValue)} flags=${JSON.stringify(r.wikiCells.flags)} description=${JSON.stringify(r.wikiCells.description)}`);
  lines.push(`    restored     : defaultValue=${JSON.stringify(r.restored.defaultValue)} flags=[${r.restored.flags.join(', ')}] descriptionEn=${JSON.stringify(r.restored.descriptionEn)}`);
  lines.push(`    why          : ${r.why}`);
}
lines.push('');
lines.push(`misalignment guard (criterion C): ${misalignedRows.length} row(s) with a bare engine-flag Default Value or a value duplicated into the Flags cell`);
for (const r of misalignedRows) lines.push(`  ${r.command}: ${r.reason}`);
lines.push('');
lines.push(`source-defect ledger (meta.sourceDefects): ${sourceDefects.count} entries in ${Object.keys(defectByType).length} classes`);
lines.push('  detectors:');
for (const d of sourceDefects.detectors) lines.push(`    ${d.id.padEnd(30)} ${d.hits}  ${d.zh}`);
lines.push('  entries:');
for (const e of sourceDefectEntries) {
  lines.push(`    [${e.index}] ${e.type} (${e.typeZh}) detail=${e.detail}`);
  lines.push(`         ${JSON.stringify(e.descriptionEn)}`);
}
lines.push('');
lines.push('flagFrequency:');
for (const [f, n] of Object.entries(flagFrequency).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
  lines.push(`  ${f.padEnd(22)} ${n}`);
}
lines.push('');
lines.push(`checks: ${checks.filter((c) => c.ok).length}/${checks.length} passed`);
for (const c of checks) if (!c.ok) lines.push(`  FAILED: ${c.label}`);
lines.push('');
lines.push('outputs:');
lines.push('  data/commands.json');
lines.push('  data/translation/glossary.json');
lines.push('  data/translation/README.md');
lines.push(`  data/translation/chunks/*.json (${chunks.length} files)`);
lines.push('  data/translation/out/ (translator output dir, kept)');
lines.push('  data/prepare-report.txt');
const report = lines.join('\n') + '\n';
writeFileSync(REPORT, report, 'utf8');

console.log(report);
if (failures.length) {
  console.error(`\nBUILD FAILED: ${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
