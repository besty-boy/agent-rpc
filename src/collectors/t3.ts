import { normalizeAgentId } from '../registry.js';
import type { AgentActivityState, AgentId, AgentSnapshot, SessionSnapshot } from '../types.js';
import {
  emptyTokens,
  getTableColumns,
  homePath,
  normalizeTimestampMs,
  projectNameFromPath,
  safeStat,
  SqliteQueryCache,
  WEEK_MS,
} from './utils.js';

export interface T3ProviderEnrichment {
  agentId: AgentId;
  active: boolean;
  state: AgentActivityState;
  project?: string;
  cwd?: string;
  model?: string;
  activeRunCount: number;
  activeSubagentCount: number;
  startedAtMs: number;
  lastActivityMs: number;
}

export interface T3CollectionResult {
  t3Snapshot: AgentSnapshot | null;
  enrichments: Map<AgentId, T3ProviderEnrichment>;
}

interface RunRow {
  run_id: string;
  thread_id: string;
  provider: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
  thread_title: string | null;
  project_title: string | null;
  workspace_root: string | null;
}

interface ProviderSessionRow {
  provider: string;
  driver: string | null;
  status: string;
  model: string | null;
  updated_at: string;
  thread_id: string | null;
}

interface SubagentRow {
  provider: string;
  status: string;
  started_at: string | null;
  updated_at: string | null;
}

const RUNNING_STATUSES = new Set(['running', 'starting', 'preparing', 'queued', 'waiting']);
const t3DbCache = new SqliteQueryCache<{
  runs: RunRow[];
  providerSessions: ProviderSessionRow[];
  subagents: SubagentRow[];
}>();

export function collectT3Code(activeWindowMs: number, nowMs = Date.now()): T3CollectionResult {
  const dbPath = homePath('.t3', 'userdata', 'statev2.sqlite');
  const enrichments = new Map<AgentId, T3ProviderEnrichment>();
  if (!safeStat(dbPath)) {
    return { t3Snapshot: null, enrichments };
  }

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  const data = t3DbCache.query(dbPath, (db) => {
    const runCols = getTableColumns(db, 'orchestration_v2_projection_runs');
    const threadCols = getTableColumns(db, 'orchestration_v2_projection_threads');
    const projCols = getTableColumns(db, 'projection_projects');
    const psCols = getTableColumns(db, 'orchestration_v2_projection_provider_sessions');
    const subCols = getTableColumns(db, 'orchestration_v2_projection_subagents');

    let runs: RunRow[] = [];
    if (runCols.size > 0 && threadCols.size > 0 && projCols.size > 0) {
      runs = db
        .prepare(
          `SELECT r.run_id, r.thread_id, r.provider, r.status, r.requested_at, r.completed_at,
                  t.title AS thread_title, p.title AS project_title, p.workspace_root AS workspace_root
           FROM orchestration_v2_projection_runs r
           LEFT JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
           LEFT JOIN projection_projects p ON p.project_id = t.project_id
           ORDER BY r.requested_at DESC
           LIMIT 80`,
        )
        .all() as unknown as RunRow[];
    }

    let providerSessions: ProviderSessionRow[] = [];
    if (psCols.size > 0) {
      providerSessions = db
        .prepare(
          `SELECT provider, ${psCols.has('driver') ? 'driver' : 'NULL AS driver'}, status, model, updated_at, thread_id
           FROM orchestration_v2_projection_provider_sessions
           ORDER BY updated_at DESC
           LIMIT 40`,
        )
        .all() as unknown as ProviderSessionRow[];
    }

    let subagents: SubagentRow[] = [];
    if (subCols.size > 0) {
      subagents = db
        .prepare(
          `SELECT provider, status, started_at, updated_at
           FROM orchestration_v2_projection_subagents
           ORDER BY updated_at DESC
           LIMIT 40`,
        )
        .all() as unknown as SubagentRow[];
    }

    return { runs, providerSessions, subagents };
  });

  if (!data) {
    return { t3Snapshot: null, enrichments };
  }

  // Build model lookup by thread_id and provider
  const modelByThread = new Map<string, string>();
  const modelByProvider = new Map<AgentId, string>();
  for (const ps of data.providerSessions) {
    const agentId = normalizeAgentId(ps.provider || ps.driver || '');
    if (ps.model) {
      if (ps.thread_id && !modelByThread.has(ps.thread_id)) {
        modelByThread.set(ps.thread_id, ps.model);
      }
      if (!modelByProvider.has(agentId)) {
        modelByProvider.set(agentId, ps.model);
      }
    }
  }

  // Count active subagents by provider
  const activeSubsByAgent = new Map<AgentId, number>();
  for (const sub of data.subagents) {
    const agentId = normalizeAgentId(sub.provider);
    const updatedMs = normalizeTimestampMs(sub.updated_at) ?? 0;
    const isRunning = RUNNING_STATUSES.has(sub.status) && nowMs - updatedMs < 30 * 60_000;
    if (isRunning) {
      activeSubsByAgent.set(agentId, (activeSubsByAgent.get(agentId) ?? 0) + 1);
    }
  }

  let latestT3ActivityMs = 0;
  let latestT3StartMs = nowMs;
  let latestT3Project: string | undefined;
  let latestT3Cwd: string | undefined;
  let latestT3Model: string | undefined;
  let totalActiveRuns = 0;
  let weeklyRuns = 0;

  for (const run of data.runs) {
    const agentId = normalizeAgentId(run.provider);
    const reqMs = normalizeTimestampMs(run.requested_at) ?? 0;
    const compMs = normalizeTimestampMs(run.completed_at);
    const isRunning = RUNNING_STATUSES.has(run.status) && !compMs && nowMs - reqMs < 6 * 3_600_000;
    const lastMs = isRunning ? nowMs : (compMs ?? reqMs);

    if (lastMs >= weekCutoff) weeklyRuns += 1;
    const isActive = isRunning || lastMs >= activeCutoff;
    if (isActive) totalActiveRuns += 1;

    const project = run.project_title || projectNameFromPath(run.workspace_root);
    const model = modelByThread.get(run.thread_id) ?? modelByProvider.get(agentId);

    if (lastMs > latestT3ActivityMs) {
      latestT3ActivityMs = lastMs;
      latestT3StartMs = reqMs || lastMs;
      latestT3Project = project;
      latestT3Cwd = run.workspace_root ?? undefined;
      latestT3Model = model;
    }

    const existing = enrichments.get(agentId);
    const runState: AgentActivityState = isRunning ? 'thinking' : isActive ? 'coding' : 'idle';
    if (!existing) {
      enrichments.set(agentId, {
        agentId,
        active: isActive,
        state: runState,
        project,
        cwd: run.workspace_root ?? undefined,
        model,
        activeRunCount: isActive ? 1 : 0,
        activeSubagentCount: activeSubsByAgent.get(agentId) ?? 0,
        startedAtMs: reqMs || lastMs,
        lastActivityMs: lastMs,
      });
    } else {
      if (isActive) existing.active = true;
      if (isRunning) existing.state = 'thinking';
      if (isActive) existing.activeRunCount += 1;
      if (lastMs > existing.lastActivityMs) {
        existing.lastActivityMs = lastMs;
        if (project) existing.project = project;
        if (run.workspace_root) existing.cwd = run.workspace_root;
        if (model) existing.model = model;
      }
      if (isActive && reqMs > 0 && reqMs < existing.startedAtMs) {
        existing.startedAtMs = reqMs;
      }
    }
  }

  // Also include ready provider sessions if no runs matched
  for (const ps of data.providerSessions) {
    const agentId = normalizeAgentId(ps.provider || ps.driver || '');
    const updatedMs = normalizeTimestampMs(ps.updated_at) ?? 0;
    const isActive = (ps.status === 'ready' || ps.status === 'running') && updatedMs >= activeCutoff;
    if (updatedMs > latestT3ActivityMs) {
      latestT3ActivityMs = updatedMs;
    }
    if (isActive && !enrichments.has(agentId)) {
      enrichments.set(agentId, {
        agentId,
        active: true,
        state: 'coding',
        model: ps.model ?? undefined,
        activeRunCount: 1,
        activeSubagentCount: activeSubsByAgent.get(agentId) ?? 0,
        startedAtMs: updatedMs,
        lastActivityMs: updatedMs,
      });
    }
  }

  const active = totalActiveRuns > 0 || latestT3ActivityMs >= activeCutoff;
  const currentSession: SessionSnapshot | undefined = latestT3ActivityMs
    ? {
        id: 't3-orchestrator',
        agentId: 't3',
        surface: 'desktop',
        state: active ? 'coding' : 'idle',
        model: latestT3Model,
        project: latestT3Project,
        cwd: latestT3Cwd,
        startedAtMs: latestT3StartMs,
        lastActivityMs: latestT3ActivityMs,
      }
    : undefined;

  const t3Snapshot: AgentSnapshot = {
    agentId: 't3',
    displayName: 'T3 Code',
    installed: true,
    active,
    state: currentSession?.state ?? 'offline',
    currentSession,
    activeSessionCount: Math.max(totalActiveRuns, active ? 1 : 0),
    weeklySessionCount: weeklyRuns,
    sessionTokens: emptyTokens(),
    weeklyTokens: emptyTokens(),
    processCount: 0,
    lastActivityMs: latestT3ActivityMs,
    sources: ['t3-sqlite'],
  };

  return { t3Snapshot, enrichments };
}
