import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgentMetadata } from '../registry.js';
import type { AppConfig, DaemonRuntimeStatus, LiveEventInput } from '../types.js';
import { renderDashboardHtml } from './dashboard.js';

export interface DaemonApiHandlers {
  getStatus: () => DaemonRuntimeStatus;
  getConfig: () => AppConfig;
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  ingestEvent: (event: LiveEventInput) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  setOverrideAgent: (agentId: string | null) => Promise<void>;
}

function getMascotsDir(): string {
  // Works both from dist/src/server/api.js and src/server/api.ts
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../assets/mascots'),
    path.resolve(here, '../../assets/mascots'),
    path.resolve(process.cwd(), 'assets/mascots'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

async function readBody(req: http.IncomingMessage, maxBytes = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export class LocalApiServer {
  private server: http.Server | null = null;
  private host: string;
  private port: number;
  private handlers: DaemonApiHandlers;
  private mascotsDir: string;

  constructor(host: string, port: number, handlers: DaemonApiHandlers) {
    this.host = host;
    this.port = port;
    this.handlers = handlers;
    this.mascotsDir = getMascotsDir();
  }

  get url(): string {
    return `http://${this.host}:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const srv = this.server!;
      const onError = (err: Error) => reject(err);
      srv.once('error', onError);
      srv.listen(this.port, this.host, () => {
        srv.off('error', onError);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const urlObj = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);
    const pathname = urlObj.pathname;

    try {
      if (method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(renderDashboardHtml());
        return;
      }

      if (method === 'GET' && pathname.startsWith('/mascots/')) {
        const rawName = decodeURIComponent(pathname.slice('/mascots/'.length)).replace(/\.png$/i, '');
        const safeId = rawName.replace(/[^a-zA-Z0-9_-]/g, '');
        const meta = getAgentMetadata(safeId, this.handlers.getConfig().customAgents);
        const candidates = [
          path.join(this.mascotsDir, `${safeId}.png`),
          path.join(this.mascotsDir, `${meta.mascotKey}.png`),
          path.join(this.mascotsDir, 'generic.png'),
        ];
        const found = candidates.find((p) => fs.existsSync(p));
        if (!found) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
        fs.createReadStream(found).pipe(res);
        return;
      }

      if (method === 'GET' && pathname === '/v1/status') {
        sendJson(res, 200, this.handlers.getStatus());
        return;
      }

      if (method === 'GET' && pathname === '/v1/agents') {
        sendJson(res, 200, this.handlers.getStatus().fleet);
        return;
      }

      if (method === 'GET' && pathname === '/v1/config') {
        sendJson(res, 200, this.handlers.getConfig());
        return;
      }

      if (method === 'PATCH' && pathname === '/v1/config') {
        const raw = await readBody(req);
        const patch = JSON.parse(raw || '{}') as Partial<AppConfig>;
        const updated = await this.handlers.updateConfig(patch);
        sendJson(res, 200, updated);
        return;
      }

      if (method === 'POST' && pathname === '/v1/event') {
        const raw = await readBody(req);
        const payload = JSON.parse(raw || '{}') as LiveEventInput;
        if (!payload || typeof payload.agent !== 'string' || !payload.agent.trim()) {
          sendJson(res, 400, { error: 'Missing required "agent" field' });
          return;
        }
        await this.handlers.ingestEvent(payload);
        sendJson(res, 202, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/pause') {
        await this.handlers.setPaused(true);
        sendJson(res, 200, { paused: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/resume') {
        await this.handlers.setPaused(false);
        sendJson(res, 200, { paused: false });
        return;
      }

      if (method === 'POST' && pathname === '/v1/override') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as { agentId?: string | null };
        await this.handlers.setOverrideAgent(body.agentId ?? null);
        sendJson(res, 200, { overrideAgentId: body.agentId ?? null });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
