import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import type { TokenUsage } from '../types.js';

const execFileAsync = promisify(execFile);

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

export function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
}

export function addTokens(target: TokenUsage, delta: Partial<TokenUsage> | undefined): TokenUsage {
  if (!delta) return target;
  const input = Math.max(0, Number(delta.input) || 0);
  const output = Math.max(0, Number(delta.output) || 0);
  const cacheRead = Math.max(0, Number(delta.cacheRead) || 0);
  const cacheWrite = Math.max(0, Number(delta.cacheWrite) || 0);
  const reasoning = Math.max(0, Number(delta.reasoning) || 0);
  const explicitTotal = Number(delta.total) || 0;
  const computed = input + output + cacheRead + cacheWrite + reasoning;

  target.input += input;
  target.output += output;
  target.cacheRead = (target.cacheRead ?? 0) + cacheRead;
  target.cacheWrite = (target.cacheWrite ?? 0) + cacheWrite;
  target.reasoning = (target.reasoning ?? 0) + reasoning;
  target.total += Math.max(explicitTotal, computed);
  return target;
}

export function normalizeTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Distinguish seconds (< 1e11) vs milliseconds (>= 1e11)
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum < 1e11 ? Math.round(asNum * 1000) : Math.round(asNum);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

export function safeReadDir(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function readJsonFile<T = unknown>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function projectNameFromPath(dirPath: string | undefined | null): string | undefined {
  if (!dirPath || typeof dirPath !== 'string') return undefined;
  const cleaned = dirPath.trim().replace(/\/+$/, '');
  if (!cleaned || cleaned === '/' || cleaned === os.homedir()) return undefined;
  const base = path.basename(cleaned);
  if (!base || base === '.' || base === '..') return undefined;
  return base;
}

export function homePath(...segments: string[]): string {
  return path.join(os.homedir(), ...segments);
}

/**
 * Simple mtime+size keyed cache so re-polling unchanged JSONL files is O(1) stat.
 */
interface FileCacheEntry<T> {
  mtimeMs: number;
  size: number;
  value: T;
}

export class ParsedFileCache<T> {
  private map = new Map<string, FileCacheEntry<T>>();
  private maxEntries: number;

  constructor(maxEntries = 400) {
    this.maxEntries = maxEntries;
  }

  getOrParse(filePath: string, stat: fs.Stats, parser: () => T): T {
    const existing = this.map.get(filePath);
    if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
      return existing.value;
    }
    const value = parser();
    if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  }
}

/**
 * Computes a lightweight mtime+size signature covering a SQLite DB and its WAL journal.
 * Returns null if the database file does not exist or is empty.
 */
export function getSqliteSignature(dbPath: string): string | null {
  const main = safeStat(dbPath);
  if (!main || !main.isFile() || main.size === 0) return null;
  const wal = safeStat(`${dbPath}-wal`);
  return `${main.mtimeMs}:${main.size}:${wal ? `${wal.mtimeMs}:${wal.size}` : '0'}`;
}

/**
 * Caches read-only SQLite query results keyed by main DB + WAL signature so unchanged
 * databases are never re-opened during fast poll loops.
 */
export class SqliteQueryCache<T> {
  private lastPath: string | null = null;
  private lastSig: string | null = null;
  private lastValue: T | null = null;

  query(dbPath: string, fn: (db: DatabaseSync) => T): T | null {
    const sig = getSqliteSignature(dbPath);
    if (!sig) {
      this.lastPath = null;
      this.lastSig = null;
      this.lastValue = null;
      return null;
    }
    if (this.lastPath === dbPath && this.lastSig === sig) {
      return this.lastValue;
    }
    const val = withReadonlySqlite(dbPath, fn);
    if (val !== null) {
      this.lastPath = dbPath;
      this.lastSig = sig;
      this.lastValue = val;
    }
    return val;
  }
}

/**
 * Reads JSONL lines safely. For huge files (> maxBytes), reads the first 64KB + tail (maxBytes - 64KB)
 * so session metadata at top and recent events at bottom are both captured without blowing RAM.
 */
export function readJsonlRecords(filePath: string, maxBytes = 2 * 1024 * 1024): Array<Record<string, unknown>> {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile() || stat.size === 0) return [];

  let text = '';
  try {
    if (stat.size <= maxBytes) {
      text = fs.readFileSync(filePath, 'utf8');
    } else {
      const fd = fs.openSync(filePath, 'r');
      try {
        const headSize = 64 * 1024;
        const tailSize = Math.max(64 * 1024, maxBytes - headSize);
        const headBuf = Buffer.alloc(headSize);
        const tailBuf = Buffer.alloc(tailSize);
        const headRead = fs.readSync(fd, headBuf, 0, headSize, 0);
        const tailStart = Math.max(headRead, stat.size - tailSize);
        const tailRead = fs.readSync(fd, tailBuf, 0, tailSize, tailStart);
        const headText = headBuf.subarray(0, headRead).toString('utf8');
        const tailText = tailBuf.subarray(0, tailRead).toString('utf8');
        const firstNewlineInTail = tailText.indexOf('\n');
        text =
          headText.slice(0, headText.lastIndexOf('\n') + 1) +
          '\n' +
          (firstNewlineInTail >= 0 ? tailText.slice(firstNewlineInTail + 1) : tailText);
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch {
    return [];
  }

  const results: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        results.push(obj as Record<string, unknown>);
      }
    } catch {
      // Skip partial/corrupt lines
    }
  }
  return results;
}

export function withReadonlySqlite<T>(dbPath: string, fn: (db: DatabaseSync) => T): T | null {
  const stat = safeStat(dbPath);
  if (!stat || !stat.isFile() || stat.size === 0) return null;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return fn(db);
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close error
    }
  }
}

export function getTableColumns(db: DatabaseSync, tableName: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
    return new Set(rows.map((r) => String(r.name ?? '')).filter(Boolean));
  } catch {
    return new Set();
  }
}

export interface RunningProcess {
  pid: number;
  command: string;
}

export async function listRunningProcesses(): Promise<RunningProcess[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
        ],
        { timeout: 3000, maxBuffer: 4 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout || '[]');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr
        .filter((r) => r && typeof r.CommandLine === 'string')
        .map((r) => ({ pid: Number(r.ProcessId) || 0, command: String(r.CommandLine) }));
    }

    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], {
      timeout: 3000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const procs: RunningProcess[] = [];
    for (const line of stdout.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const command = match[2] ?? '';
      if (pid === process.pid) continue;
      procs.push({ pid, command });
    }
    return procs;
  } catch {
    return [];
  }
}
