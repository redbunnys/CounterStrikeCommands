import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const DATASET_URL = '/data/commands.json';

/**
 * 数据集来源（按顺序取第一个存在的）：
 *  1. data/commands.json —— data-engineering 的冻结产物（唯一真相，工具链写这里）
 *  2. app/public/data/commands.json —— 同内容副本（data-engineering 在 app/public 下的产出）
 * 二者字节一致时行为相同；两者都不存在时构建/开发会明确报错，而不是静默给出空界面。
 */
const DATASET_CANDIDATES = [
  resolve(projectRoot, 'data/commands.json'),
  resolve(projectRoot, 'app/public/data/commands.json'),
];

function resolveDatasetFile(): string {
  const found = DATASET_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `[cs2-dataset] 找不到数据集，已尝试：\n  ${DATASET_CANDIDATES.join('\n  ')}\n` +
        '请先运行 tools/prepare-data.mjs 生成 data/commands.json。',
    );
  }
  return found;
}

/**
 * 数据契约（冻结）：前端在运行时 fetch('/data/commands.json')。
 * 构建不可写 data/ 目录，因此这里用插件把冻结数据集“只读”地暴露出去：
 *  - dev：在 Vite 内部中间件之前挂一个只读中间件，直接回原始 JSON 字节
 *    （避免 Vite 的 json 插件把它改写成 `export default ...` 的 ESM 模块）。
 *  - build：把同一个文件原样复制到 outDir/data/commands.json，
 *    使 `vite preview` / 任意静态服务器都能在同一 URL 下拿到数据。
 * dev 与 build 走的是同一个 resolveDatasetFile()，不存在“dev 读一个、build 读另一个”的分叉。
 */
function frozenDatasetPlugin(): Plugin {
  let outDir = 'dist';

  const serveDataset = (
    req: { url?: string },
    res: { setHeader(k: string, v: string): void; end(body: unknown): void; statusCode: number },
    next: () => void,
  ) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== DATASET_URL) {
      next();
      return;
    }
    try {
      const datasetFile = resolveDatasetFile();
      const body = readFileSync(datasetFile);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // 头里只能放 ASCII：路径可能含中文（工作区名），因此做 URI 编码
      res.setHeader('X-Dataset-Source', encodeURIComponent(relative(projectRoot, datasetFile)));
      res.end(body);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: 'dataset-unavailable',
          message: error instanceof Error ? error.message : String(error),
          candidates: DATASET_CANDIDATES,
        }),
      );
    }
  };

  return {
    name: 'cs2-frozen-dataset',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      // 直接注册 => 运行在 Vite 内部中间件之前
      server.middlewares.use(serveDataset);
      server.config.logger.info(`[cs2-dataset] dev 将在 ${DATASET_URL} 提供 ${resolveDatasetFile()}`);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveDataset);
    },
    closeBundle() {
      let datasetFile: string;
      try {
        datasetFile = resolveDatasetFile();
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
        return;
      }
      const target = resolve(projectRoot, outDir, 'data/commands.json');
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(datasetFile, target);
      const bytes = statSync(target).size;
      const sourceBytes = statSync(datasetFile).size;
      if (bytes !== sourceBytes) {
        this.error(`[cs2-dataset] 复制后字节数不一致（${bytes} != ${sourceBytes}）`);
        return;
      }
      this.info(
        `[cs2-dataset] 已复制数据集 ${datasetFile} -> ${target} (${(bytes / 1024).toFixed(1)} KB, ${bytes} 字节)`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), frozenDatasetPlugin()],
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
});
