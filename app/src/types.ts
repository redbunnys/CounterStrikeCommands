/**
 * 数据契约（冻结，v1）—— 与 data/commands.json 严格一致，前端不得假设额外字段。
 * 运行时通过 fetch('/data/commands.json') 取得。
 */

export interface CommandEntry {
  id: number;
  /** 控制台命令名，如 sv_cheats、+lookatweapon */
  command: string;
  /** 默认值；'cmd' 表示该条目本身是命令而非变量；null 表示数据源没有默认值 */
  defaultValue: string | null;
  /** 引擎标记，取值见 FLAG_LABELS 白名单 */
  flags: string[];
  /** 英文原始描述（可能为空串） */
  descriptionEn: string;
  /** 简体中文描述；merge 前可能为空串 */
  descriptionZh: string;
  /** 首字母段落：A-Z 或 '_'（'_' 表示 Cvar_list 等其它分组） */
  section: string;
}

export interface DatasetMeta {
  schemaVersion?: number;
  source?: string;
  sourceRetrieved?: string;
  sourceBuild?: string;
  generatedAt?: string;
  generatedBy?: string;
  commands?: number;
  withEnglishDescription?: number;
  uniqueEnglishDescriptions?: number;
  chunks?: number;
  chunkSize?: number;
  translationStatus?: { descriptionZhFilled?: number; workUnits?: number };
  [key: string]: unknown;
}

export interface Dataset {
  meta: DatasetMeta;
  commands: CommandEntry[];
}

export interface DatasetWarning {
  id: string;
  text: string;
}

export type DatasetState =
  | { status: 'loading' }
  | { status: 'ready'; dataset: Dataset; warnings: DatasetWarning[] }
  | { status: 'error'; message: string; detail: string; hints: string[] };
