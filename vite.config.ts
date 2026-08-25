import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const perfectPixelService = resolve(projectRoot, 'perfect_pixel_service.py');
const maxPerfectPixelRequestBytes = 25 * 1024 * 1024;

function sendJson(response: import('node:http').ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function runPerfectPixel(payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolveResult, rejectResult) => {
    const python = process.env.PYTHON_BIN?.trim() || 'python3';
    const child = spawn(python, [perfectPixelService], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      rejectResult(Object.assign(new Error('Perfect Pixel 服务处理超时。'), { code: 'processing-timeout' }));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectResult(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString('utf8').trim();
      if (!output) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        rejectResult(new Error(detail || `Perfect Pixel 服务退出（${code ?? 'unknown'}）。`));
        return;
      }
      try {
        const result = JSON.parse(output) as Record<string, unknown>;
        if (result.ok !== true) {
          const error = new Error(typeof result.error === 'string' ? result.error : 'Perfect Pixel 处理失败。');
          Object.assign(error, { code: result.code });
          rejectResult(error);
          return;
        }
        resolveResult(result);
      } catch (error) {
        rejectResult(new Error(`Perfect Pixel 服务返回了无效 JSON：${error instanceof Error ? error.message : 'unknown error'}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function perfectPixelDevApi(): Plugin {
  return {
    name: 'perfect-pixel-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/perfect-pixel', async (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > maxPerfectPixelRequestBytes) {
              sendJson(response, 413, { ok: false, code: 'PAYLOAD_TOO_LARGE', error: '请求图片过大（最大 25MB）。' });
              request.destroy();
              return;
            }
            chunks.push(buffer);
          }
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { image?: unknown };
          if (typeof payload.image !== 'string' || payload.image.length === 0) {
            sendJson(response, 400, { ok: false, code: 'INVALID_REQUEST', error: '缺少 image（data URL）。' });
            return;
          }
          const result = await runPerfectPixel(payload);
          sendJson(response, 200, result);
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'perfect-pixel-error';
          const status = code === 'missing-dependency'
            ? 503
            : code === 'invalid-parameters'
              ? 400
              : code === 'grid-detection-failed'
                ? 422
                : code === 'PAYLOAD_TOO_LARGE'
                  ? 413
                  : 502;
          sendJson(response, status, {
            ok: false,
            code,
            error: error instanceof Error ? error.message : 'Perfect Pixel 服务不可用。',
          });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), perfectPixelDevApi()],
  server: {
    port: 5174,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
