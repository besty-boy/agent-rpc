import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { DiscordActivityPayload } from '../types.js';

export const OPCODE_HANDSHAKE = 0;
export const OPCODE_FRAME = 1;
export const OPCODE_CLOSE = 2;
export const OPCODE_PING = 3;
export const OPCODE_PONG = 4;

export interface IpcFrame {
  opcode: number;
  payload: Record<string, unknown>;
}

export interface DiscordReadyUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export function encodeFrame(opcode: number, payload: unknown): Buffer {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export function decodeFrames(buffer: Buffer): { frames: IpcFrame[]; remainder: Buffer } {
  const frames: IpcFrame[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const opcode = buffer.readInt32LE(offset);
    const len = buffer.readInt32LE(offset + 4);
    if (len < 0 || len > 16 * 1024 * 1024) {
      // Malformed frame length; drop buffer
      return { frames, remainder: Buffer.alloc(0) };
    }
    if (offset + 8 + len > buffer.length) {
      break;
    }
    const raw = buffer.subarray(offset + 8, offset + 8 + len).toString('utf8');
    offset += 8 + len;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      frames.push({ opcode, payload: parsed });
    } catch {
      // Ignore malformed JSON frame
    }
  }

  return {
    frames,
    remainder: offset < buffer.length ? Buffer.from(buffer.subarray(offset)) : Buffer.alloc(0),
  };
}

let cachedDarwinTempDir: string | null | undefined;

function getDarwinUserTempDir(): string | null {
  if (cachedDarwinTempDir !== undefined) return cachedDarwinTempDir;
  if (process.platform !== 'darwin') {
    cachedDarwinTempDir = null;
    return null;
  }
  try {
    const out = execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    cachedDarwinTempDir = out || null;
  } catch {
    cachedDarwinTempDir = null;
  }
  return cachedDarwinTempDir;
}

export function discoverDiscordIpcPaths(): string[] {
  if (process.env.DISCORD_IPC_PATH) {
    return [process.env.DISCORD_IPC_PATH];
  }

  if (process.platform === 'win32') {
    const pipes: string[] = [];
    for (let i = 0; i < 10; i++) {
      pipes.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    }
    return pipes;
  }

  const dirs = new Set<string>();
  const addDir = (d: string | null | undefined) => {
    if (d && d.trim()) dirs.add(d.replace(/\/+$/, ''));
  };

  addDir(getDarwinUserTempDir());
  addDir(process.env.XDG_RUNTIME_DIR);
  if (process.env.XDG_RUNTIME_DIR) {
    addDir(path.join(process.env.XDG_RUNTIME_DIR, 'app', 'com.discordapp.Discord'));
    addDir(path.join(process.env.XDG_RUNTIME_DIR, 'snap.discord'));
  }
  addDir(process.env.TMPDIR);
  addDir(process.env.TEMP);
  addDir(process.env.TMP);
  addDir(os.tmpdir());
  addDir('/tmp');

  const existing: string[] = [];
  const candidates: string[] = [];

  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) {
      const sock = path.join(dir, `discord-ipc-${i}`);
      candidates.push(sock);
      try {
        const stat = fs.statSync(sock);
        if (stat.isSocket()) {
          existing.push(sock);
        }
      } catch {
        // Not present
      }
    }
  }

  return existing.length > 0 ? existing : candidates;
}

export class DiscordIpcClient extends EventEmitter {
  readonly clientId: string;
  private socket: net.Socket | null = null;
  private socketPath: string | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private connected = false;
  private readyUser: DiscordReadyUser | undefined;
  private pending = new Map<
    string,
    { resolve: (val: Record<string, unknown>) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(clientId: string) {
    super();
    this.clientId = clientId;
  }

  get isConnected(): boolean {
    return this.connected && this.socket !== null && !this.socket.destroyed;
  }

  get currentSocketPath(): string | null {
    return this.socketPath;
  }

  get user(): DiscordReadyUser | undefined {
    return this.readyUser;
  }

  async connect(explicitSocketPaths?: string[], timeoutMs = 5000): Promise<DiscordReadyUser | undefined> {
    const paths = explicitSocketPaths ?? discoverDiscordIpcPaths();
    let lastError: Error = new Error('No Discord IPC socket found (is Discord desktop running?)');

    for (const sockPath of paths) {
      try {
        const user = await this.tryConnectSingle(sockPath, timeoutMs);
        this.socketPath = sockPath;
        this.connected = true;
        this.readyUser = user;
        this.emit('ready', user);
        return user;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError;
  }

  private tryConnectSingle(sockPath: string, timeoutMs: number): Promise<DiscordReadyUser | undefined> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection(sockPath);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        reject(err);
      };

      const timer = setTimeout(() => {
        fail(new Error(`Discord IPC handshake timed out on ${sockPath}`));
      }, timeoutMs);

      let handshakeBuf: Buffer = Buffer.alloc(0);

      socket.once('error', (err) => fail(err));

      socket.once('connect', () => {
        socket.write(encodeFrame(OPCODE_HANDSHAKE, { v: 1, client_id: this.clientId }));
      });

      const onHandshakeData = (chunk: Buffer) => {
        handshakeBuf = Buffer.concat([handshakeBuf, chunk]);
        const { frames, remainder } = decodeFrames(handshakeBuf);
        handshakeBuf = remainder;

        for (const frame of frames) {
          if (frame.opcode === OPCODE_CLOSE) {
            const msg = typeof frame.payload.message === 'string' ? frame.payload.message : 'Discord closed connection';
            fail(new Error(msg));
            return;
          }
          if (frame.opcode === OPCODE_FRAME && frame.payload.evt === 'READY') {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.off('data', onHandshakeData);
            this.socket = socket;
            this.buffer = handshakeBuf;
            this.attachRuntimeListeners(socket);

            const data = frame.payload.data as Record<string, unknown> | undefined;
            const userObj = data?.user as DiscordReadyUser | undefined;
            resolve(userObj);
            return;
          }
          if (frame.opcode === OPCODE_FRAME && frame.payload.evt === 'ERROR') {
            const data = frame.payload.data as Record<string, unknown> | undefined;
            const msg = typeof data?.message === 'string' ? data.message : 'Discord RPC error';
            fail(new Error(msg));
            return;
          }
        }
      };

      socket.on('data', onHandshakeData);
    });
  }

  private attachRuntimeListeners(socket: net.Socket): void {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const { frames, remainder } = decodeFrames(this.buffer);
      this.buffer = remainder;

      for (const frame of frames) {
        if (frame.opcode === OPCODE_PING) {
          this.writeSafe(encodeFrame(OPCODE_PONG, frame.payload));
          continue;
        }
        if (frame.opcode === OPCODE_CLOSE) {
          this.handleDisconnect('Discord closed IPC socket');
          return;
        }
        if (frame.opcode === OPCODE_FRAME) {
          const nonce = typeof frame.payload.nonce === 'string' ? frame.payload.nonce : null;
          if (nonce && this.pending.has(nonce)) {
            const entry = this.pending.get(nonce)!;
            this.pending.delete(nonce);
            clearTimeout(entry.timer);
            if (frame.payload.evt === 'ERROR') {
              const data = frame.payload.data as Record<string, unknown> | undefined;
              entry.reject(new Error(typeof data?.message === 'string' ? data.message : 'Discord RPC command failed'));
            } else {
              entry.resolve(frame.payload);
            }
          }
        }
      }
    });

    socket.on('error', (err) => {
      this.emit('error', err);
      this.handleDisconnect(err.message);
    });

    socket.on('close', () => {
      this.handleDisconnect('Socket closed');
    });
  }

  private writeSafe(buf: Buffer): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(buf);
    }
  }

  private handleDisconnect(reason: string): void {
    const wasConnected = this.connected;
    this.connected = false;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    if (wasConnected) {
      this.emit('close', reason);
    }
  }

  private sendCommand(
    cmd: string,
    args: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    if (!this.isConnected || !this.socket) {
      return Promise.reject(new Error('Discord IPC is not connected'));
    }
    const nonce = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`Discord RPC command ${cmd} timed out`));
      }, timeoutMs);

      this.pending.set(nonce, { resolve, reject, timer });
      this.writeSafe(encodeFrame(OPCODE_FRAME, { cmd, args, nonce }));
    });
  }

  async setActivity(activity: DiscordActivityPayload): Promise<void> {
    await this.sendCommand('SET_ACTIVITY', {
      pid: process.pid,
      activity,
    });
  }

  async clearActivity(): Promise<void> {
    if (!this.isConnected) return;
    await this.sendCommand('SET_ACTIVITY', {
      pid: process.pid,
      activity: null,
    });
  }

  async close(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.writeSafe(encodeFrame(OPCODE_CLOSE, {}));
      } catch {
        // Ignore write error on close
      }
    }
    this.handleDisconnect('Client closed');
  }
}
