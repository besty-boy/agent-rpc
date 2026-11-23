import type { AgentActivityState, AgentSnapshot, SessionSnapshot, TokenUsage } from '../types.js';
import {
  addTokens,
  emptyTokens,
  getTableColumns,
  homePath,
  normalizeTimestampMs,
  projectNameFromPath,
  safeStat,
  SqliteQueryCache,
  WEEK_MS,
} from './utils.js';

const openCodeDbCache = new SqliteQueryCache<OpenCodeSessionRow[]>();

interface OpenCodeSessionRow {
  id: string;
  directory?: string | null;
  agent?: string | null;
  model?: string | null;
  cost?: number | null;
  tokens_input?: number | null;
  tokens_output?: number | null;
  tokens_reasoning?: number | null;
  tokens_cache_read?: number | null;
  tokens_cache_write?: number | null;
  time_created?: number | null;
  time_updated?: number | null;
  time_busy?: number | null;
  time_idle?: number | null;
}

function parseOpenCodeModel(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as { id?: string; modelID?: string; providerID?: string };
      return obj.id || obj.modelID || undefined;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function rowToTokens(row: OpenCodeSessionRow): TokenUsage {
  const t = emptyTokens();
  addTokens(t, {
    input: Number(row.tokens_input) || 0,
    output: Number(row.tokens_output) || 0,
    reasoning: Number(row.tokens_reasoning) || 0,
    cacheRead: Number(row.tokens_cache_read) || 0,
    cacheWrite: Number(row.tokens_cache_write) || 0,
  });
  return t;
}

export function collectOpenCode(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const dbPath = homePath('.local', 'share', 'opencode', 'opencode.db');
  const hasAny =
    Boolean(safeStat(dbPath)) ||
    Boolean(safeStat(homePath('.opencode'))) ||
    Boolean(safeStat(homePath('.config', 'opencode')));
  if (!hasAny) return null;

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  const result = openCodeDbCache.query(dbPath, (db) => {
    const tables = ['session_v2', 'session'];
    const allRows: OpenCodeSessionRow[] = [];
    const seenIds = new Set<string>();

    for (const table of tables) {
      const cols = getTableColumns(db, table);
      if (cols.size === 0) continue;

      const selectCols = [
        'id',
        cols.has('directory') ? 'directory' : 'NULL AS directory',
        cols.has('agent') ? 'agent' : 'NULL AS agent',
        cols.has('model') ? 'model' : 'NULL AS model',
        cols.has('cost') ? 'cost' : '0 AS cost',
        cols.has('tokens_input') ? 'tokens_input' : '0 AS tokens_input',
        cols.has('tokens_output') ? 'tokens_output' : '0 AS tokens_output',
        cols.has('tokens_reasoning') ? 'tokens_reasoning' : '0 AS tokens_reasoning',
        cols.has('tokens_cache_read') ? 'tokens_cache_read' : '0 AS tokens_cache_read',
        cols.has('tokens_cache_write') ? 'tokens_cache_write' : '0 AS tokens_cache_write',
        cols.has('time_created') ? 'time_created' : '0 AS time_created',
        cols.has('time_updated') ? 'time_updated' : '0 AS time_updated',
        cols.has('time_busy') ? 'time_busy' : 'NULL AS time_busy',
        cols.has('time_idle') ? 'time_idle' : 'NULL AS time_idle',
      ];

      const rows = db
        .prepare(
          `SELECT ${selectCols.join(', ')} FROM ${table} ORDER BY time_updated DESC LIMIT 200`,
        )
        .all() as unknown as OpenCodeSessionRow[];

      for (const row of rows) {
        if (!row.id || seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        allRows.push(row);
      }
    }

    return allRows;
  });

  if (!result || result.length === 0) {
    return {
      agentId: 'opencode',
      displayName: 'OpenCode',
      installed: true,
      active: false,
      state: 'offline',
      activeSessionCount: 0,
      weeklySessionCount: 0,
      sessionTokens: emptyTokens(),
      weeklyTokens: emptyTokens(),
      processCount: 0,
      lastActivityMs: 0,
      sources: ['sqlite'],
    };
  }

  result.sort((a, b) => (normalizeTimestampMs(b.time_updated) ?? 0) - (normalizeTimestampMs(a.time_updated) ?? 0));

  const weeklyTokens = emptyTokens();
  let weeklyCostUsd = 0;
  let weeklySessionCount = 0;
  let activeSessionCount = 0;

  for (const row of result) {
    const updatedMs = normalizeTimestampMs(row.time_updated) ?? 0;
    if (updatedMs >= weekCutoff) {
      weeklySessionCount += 1;
      addTokens(weeklyTokens, rowToTokens(row));
      weeklyCostUsd += Math.max(0, Number(row.cost) || 0);
    }
    if (updatedMs >= activeCutoff) {
      activeSessionCount += 1;
    }
  }

  const latest = result[0]!;
  const latestUpdatedMs = normalizeTimestampMs(latest.time_updated) ?? 0;
  const latestCreatedMs = normalizeTimestampMs(latest.time_created) ?? latestUpdatedMs;
  const latestBusyMs = normalizeTimestampMs(latest.time_busy) ?? 0;
  const latestIdleMs = normalizeTimestampMs(latest.time_idle) ?? 0;
  const sessionTokens = rowToTokens(latest);
  const sessionCostUsd = Math.max(0, Number(latest.cost) || 0);
  const active = activeSessionCount > 0;
  const isBusy = active && latestBusyMs > latestIdleMs && nowMs - latestUpdatedMs < 60_000;

  const state: AgentActivityState = active ? (isBusy ? 'thinking' : 'coding') : 'idle';
  const currentSession: SessionSnapshot = {
    id: latest.id,
    agentId: 'opencode',
    surface: 'sqlite',
    state,
    model: parseOpenCodeModel(latest.model),
    project: projectNameFromPath(latest.directory),
    cwd: latest.directory ?? undefined,
    statusDetail: latest.agent ? `${latest.agent} mode` : undefined,
    startedAtMs: latestCreatedMs,
    lastActivityMs: latestUpdatedMs,
    tokens: sessionTokens,
    costUsd: sessionCostUsd || undefined,
  };

  return {
    agentId: 'opencode',
    displayName: 'OpenCode',
    installed: true,
    active,
    state,
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens,
    weeklyTokens,
    sessionCostUsd: sessionCostUsd || undefined,
    weeklyCostUsd: weeklyCostUsd || undefined,
    processCount: 0,
    lastActivityMs: latestUpdatedMs,
    sources: ['sqlite'],
  };
}
