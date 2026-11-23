import path from 'node:path';
import type { AgentActivityState, AgentSnapshot, SessionSnapshot } from '../types.js';
import {
  emptyTokens,
  getTableColumns,
  homePath,
  normalizeTimestampMs,
  projectNameFromPath,
  readJsonFile,
  safeReadDir,
  safeStat,
  SqliteQueryCache,
  WEEK_MS,
} from './utils.js';

const cursorDbCache = new SqliteQueryCache<Array<{ model?: string; updatedAt?: number | string }>>();

interface CursorIdeState {
  recentlyViewedFiles?: Array<{ absolutePath?: string }>;
  workspaceRoot?: string;
}

export function collectCursor(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const cursorRoot = homePath('.cursor');
  const appSupportCursor =
    process.platform === 'darwin'
      ? homePath('Library', 'Application Support', 'Cursor', 'User', 'globalStorage')
      : homePath('.config', 'Cursor', 'User', 'globalStorage');

  if (!safeStat(cursorRoot)?.isDirectory() && !safeStat(appSupportCursor)?.isDirectory()) {
    return null;
  }

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  let latestMtime = 0;
  let latestModel: string | undefined;
  let latestCwd: string | undefined;
  let weeklySessionCount = 0;
  let activeSessionCount = 0;

  // 1. Check ~/.cursor/ide_state.json and agent-cli-state.json
  for (const fname of ['ide_state.json', 'agent-cli-state.json']) {
    const fpath = path.join(cursorRoot, fname);
    const stat = safeStat(fpath);
    if (stat && stat.mtimeMs > latestMtime) {
      latestMtime = stat.mtimeMs;
      const data = readJsonFile<CursorIdeState>(fpath);
      if (data?.workspaceRoot) {
        latestCwd = data.workspaceRoot;
      } else if (data?.recentlyViewedFiles?.[0]?.absolutePath) {
        latestCwd = path.dirname(data.recentlyViewedFiles[0].absolutePath);
      }
    }
  }

  // 2. Check ~/.cursor/ai-tracking/ai-code-tracking.db
  const trackingDb = path.join(cursorRoot, 'ai-tracking', 'ai-code-tracking.db');
  const dbStat = safeStat(trackingDb);
  if (dbStat && dbStat.mtimeMs > latestMtime) {
    latestMtime = dbStat.mtimeMs;
  }
  const summaryRows =
    cursorDbCache.query(trackingDb, (db) => {
      const cols = getTableColumns(db, 'conversation_summaries');
      if (cols.size === 0 || !cols.has('updatedAt')) return [];
      return db
        .prepare('SELECT model, updatedAt FROM conversation_summaries ORDER BY updatedAt DESC LIMIT 50')
        .all() as Array<{ model?: string; updatedAt?: number | string }>;
    }) ?? [];

  for (const r of summaryRows) {
    const ts = normalizeTimestampMs(r.updatedAt) ?? 0;
    if (ts >= weekCutoff) weeklySessionCount += 1;
    if (ts >= activeCutoff) activeSessionCount += 1;
    if (ts > latestMtime) {
      latestMtime = ts;
      if (r.model) latestModel = r.model;
    }
  }

  // 3. Check ~/.cursor/projects/* recent activity
  const projectsDir = path.join(cursorRoot, 'projects');
  for (const entry of safeReadDir(projectsDir)) {
    if (!entry.isDirectory()) continue;
    const pdir = path.join(projectsDir, entry.name);
    const stat = safeStat(pdir);
    if (!stat) continue;
    if (stat.mtimeMs >= weekCutoff) weeklySessionCount = Math.max(weeklySessionCount, 1);
    if (stat.mtimeMs >= activeCutoff) activeSessionCount = Math.max(activeSessionCount, 1);
    if (stat.mtimeMs > latestMtime) {
      latestMtime = stat.mtimeMs;
      if (!latestCwd) {
        const segments = entry.name.split('-').filter(Boolean);
        latestCwd = segments[segments.length - 1];
      }
    }
  }

  // 4. Check Cursor globalStorage state.vscdb mtime (only if modified very recently)
  const vscdb = path.join(appSupportCursor, 'state.vscdb');
  const vscStat = safeStat(vscdb);
  if (vscStat && vscStat.mtimeMs > latestMtime) {
    latestMtime = vscStat.mtimeMs;
  }

  if (latestMtime >= activeCutoff && activeSessionCount === 0) {
    activeSessionCount = 1;
  }

  const active = activeSessionCount > 0;
  const state: AgentActivityState = active ? 'coding' : latestMtime > 0 ? 'idle' : 'offline';

  const currentSession: SessionSnapshot | undefined = latestMtime
    ? {
        id: 'cursor-session',
        agentId: 'cursor',
        surface: 'ide',
        state,
        model: latestModel,
        project: latestCwd ? (latestCwd.includes('/') ? projectNameFromPath(latestCwd) : latestCwd) : undefined,
        cwd: latestCwd?.includes('/') ? latestCwd : undefined,
        startedAtMs: latestMtime,
        lastActivityMs: latestMtime,
      }
    : undefined;

  return {
    agentId: 'cursor',
    displayName: 'Cursor',
    installed: true,
    active,
    state,
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens: emptyTokens(),
    weeklyTokens: emptyTokens(),
    processCount: 0,
    lastActivityMs: latestMtime,
    sources: ['cursor-state'],
  };
}
