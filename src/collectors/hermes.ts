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

const hermesDbCache = new SqliteQueryCache<HermesSessionRow[]>();

interface HermesSessionRow {
  id: string;
  source?: string | null;
  model?: string | null;
  cwd?: string | null;
  git_branch?: string | null;
  started_at?: number | null;
  ended_at?: number | null;
  last_activity_at?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  reasoning_tokens?: number | null;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
}

function hermesTokens(row: HermesSessionRow): TokenUsage {
  const t = emptyTokens();
  addTokens(t, {
    input: Number(row.input_tokens) || 0,
    output: Number(row.output_tokens) || 0,
    cacheRead: Number(row.cache_read_tokens) || 0,
    cacheWrite: Number(row.cache_write_tokens) || 0,
    reasoning: Number(row.reasoning_tokens) || 0,
  });
  return t;
}

export function collectHermes(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const dbPath = homePath('.hermes', 'state.db');
  if (!safeStat(homePath('.hermes'))?.isDirectory()) return null;

  const rows = hermesDbCache.query(dbPath, (db) => {
    const cols = getTableColumns(db, 'sessions');
    if (cols.size === 0) return [];
    const pick = (name: string, fallback = 'NULL') => (cols.has(name) ? name : `${fallback} AS ${name}`);
    return db
      .prepare(
        `SELECT ${[
          'id',
          pick('source'),
          pick('model'),
          pick('cwd'),
          pick('git_branch'),
          pick('started_at', '0'),
          pick('ended_at'),
          pick('last_activity_at'),
          pick('input_tokens', '0'),
          pick('output_tokens', '0'),
          pick('cache_read_tokens', '0'),
          pick('cache_write_tokens', '0'),
          pick('reasoning_tokens', '0'),
          pick('estimated_cost_usd', '0'),
          pick('actual_cost_usd', '0'),
        ].join(', ')}
        FROM sessions
        ORDER BY COALESCE(last_activity_at, started_at) DESC
        LIMIT 100`,
      )
      .all() as unknown as HermesSessionRow[];
  });

  if (!rows || rows.length === 0) {
    return {
      agentId: 'hermes',
      displayName: 'Hermes Agent',
      installed: true,
      active: false,
      state: 'offline',
      activeSessionCount: 0,
      weeklySessionCount: 0,
      sessionTokens: emptyTokens(),
      weeklyTokens: emptyTokens(),
      processCount: 0,
      lastActivityMs: 0,
      sources: ['hermes-sqlite'],
    };
  }

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  const weeklyTokens = emptyTokens();
  let weeklyCostUsd = 0;
  let weeklySessionCount = 0;
  let activeSessionCount = 0;

  for (const row of rows) {
    const lastMs =
      normalizeTimestampMs(row.last_activity_at) ?? normalizeTimestampMs(row.started_at) ?? 0;
    const endedMs = normalizeTimestampMs(row.ended_at);
    if (lastMs >= weekCutoff) {
      weeklySessionCount += 1;
      addTokens(weeklyTokens, hermesTokens(row));
      weeklyCostUsd += Math.max(0, Number(row.actual_cost_usd) || Number(row.estimated_cost_usd) || 0);
    }
    if (lastMs >= activeCutoff && (!endedMs || endedMs >= activeCutoff)) {
      activeSessionCount += 1;
    }
  }

  const latest = rows[0]!;
  const latestLastMs =
    normalizeTimestampMs(latest.last_activity_at) ?? normalizeTimestampMs(latest.started_at) ?? 0;
  const latestStartMs = normalizeTimestampMs(latest.started_at) ?? latestLastMs;
  const sessionTokens = hermesTokens(latest);
  const sessionCostUsd =
    Math.max(0, Number(latest.actual_cost_usd) || Number(latest.estimated_cost_usd) || 0) || undefined;
  const active = activeSessionCount > 0;
  const state: AgentActivityState = active ? 'coding' : 'idle';

  const currentSession: SessionSnapshot = {
    id: latest.id,
    agentId: 'hermes',
    surface: latest.source ?? 'cli',
    state,
    model: latest.model ?? undefined,
    project: projectNameFromPath(latest.cwd),
    cwd: latest.cwd ?? undefined,
    branch: latest.git_branch ?? undefined,
    startedAtMs: latestStartMs,
    lastActivityMs: latestLastMs,
    tokens: sessionTokens,
    costUsd: sessionCostUsd,
  };

  return {
    agentId: 'hermes',
    displayName: 'Hermes Agent',
    installed: true,
    active,
    state,
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens,
    weeklyTokens,
    sessionCostUsd,
    weeklyCostUsd: weeklyCostUsd || undefined,
    processCount: 0,
    lastActivityMs: latestLastMs,
    sources: ['hermes-sqlite'],
  };
}
