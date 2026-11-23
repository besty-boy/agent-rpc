import { getAgentMetadata, normalizeAgentId } from '../registry.js';
import type {
  AgentId,
  AgentSnapshot,
  CustomAgentRule,
  LiveEventInput,
  SessionSnapshot,
} from '../types.js';
import { addTokens, emptyTokens, projectNameFromPath } from './utils.js';

interface StoredLiveSession {
  event: LiveEventInput;
  agentId: AgentId;
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
}

const DEFAULT_TTL_MS = 120_000;

export class LiveEventStore {
  private sessions = new Map<string, StoredLiveSession>();

  record(input: LiveEventInput, nowMs = Date.now()): StoredLiveSession {
    const agentId = normalizeAgentId(input.agent);
    const sessionId = input.sessionId?.trim() || `${agentId}:live`;
    const key = `${agentId}::${sessionId}`;
    const existing = this.sessions.get(key);
    const ttlMs = Math.max(10_000, Math.min(3_600_000, input.ttlMs ?? DEFAULT_TTL_MS));

    const mergedEvent: LiveEventInput = {
      ...existing?.event,
      ...input,
      agent: agentId,
      tokens: input.tokens
        ? {
            ...(existing?.event.tokens ?? {}),
            ...input.tokens,
          }
        : existing?.event.tokens,
      quota: input.quota
        ? {
            ...(existing?.event.quota ?? {}),
            ...input.quota,
          }
        : existing?.event.quota,
    };

    const stored: StoredLiveSession = {
      event: mergedEvent,
      agentId,
      sessionId,
      startedAtMs: input.startedAtMs ?? existing?.startedAtMs ?? nowMs,
      updatedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
    };

    this.sessions.set(key, stored);
    return stored;
  }

  removeSession(agent: AgentId, sessionId?: string): void {
    const agentId = normalizeAgentId(agent);
    if (sessionId) {
      this.sessions.delete(`${agentId}::${sessionId}`);
      return;
    }
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${agentId}::`)) {
        this.sessions.delete(key);
      }
    }
  }

  prune(nowMs = Date.now()): void {
    for (const [key, item] of this.sessions) {
      // Keep expired sessions for 30 min as recent idle history, then drop
      if (nowMs > item.expiresAtMs + 30 * 60_000) {
        this.sessions.delete(key);
      }
    }
  }

  getSnapshots(customAgents: CustomAgentRule[] = [], nowMs = Date.now()): AgentSnapshot[] {
    this.prune(nowMs);
    const grouped = new Map<AgentId, StoredLiveSession[]>();
    for (const item of this.sessions.values()) {
      const list = grouped.get(item.agentId) ?? [];
      list.push(item);
      grouped.set(item.agentId, list);
    }

    const snapshots: AgentSnapshot[] = [];
    for (const [agentId, items] of grouped) {
      items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      const latest = items[0]!;
      const activeItems = items.filter((i) => nowMs <= i.expiresAtMs && i.event.state !== 'offline');
      const active = activeItems.length > 0;
      const meta = getAgentMetadata(agentId, customAgents);

      const sessionTokens = emptyTokens();
      addTokens(sessionTokens, latest.event.tokens);

      const weeklyTokens = emptyTokens();
      if (typeof latest.event.weeklyTokens === 'number' && latest.event.weeklyTokens > 0) {
        weeklyTokens.total = Math.max(latest.event.weeklyTokens, sessionTokens.total);
      } else {
        addTokens(weeklyTokens, sessionTokens);
      }

      const currentSession: SessionSnapshot = {
        id: latest.sessionId,
        agentId,
        surface: latest.event.surface ?? 'hook',
        state: active ? (latest.event.state ?? 'coding') : 'idle',
        model: latest.event.model,
        project: latest.event.project ?? projectNameFromPath(latest.event.cwd),
        cwd: latest.event.cwd,
        branch: latest.event.branch,
        toolName: latest.event.toolName,
        statusDetail: latest.event.statusDetail,
        startedAtMs: latest.startedAtMs,
        lastActivityMs: latest.updatedAtMs,
        tokens: sessionTokens,
        contextWindow: latest.event.contextWindow,
        contextUsedTokens: latest.event.contextUsedTokens,
        costUsd: latest.event.costUsd,
      };

      snapshots.push({
        agentId,
        displayName: meta.displayName,
        installed: true,
        active,
        state: currentSession.state,
        currentSession,
        activeSessionCount: activeItems.length,
        weeklySessionCount: items.length,
        sessionTokens,
        weeklyTokens,
        sessionCostUsd: latest.event.costUsd,
        weeklyCostUsd: latest.event.weeklyCostUsd ?? latest.event.costUsd,
        quota: latest.event.quota,
        processCount: 0,
        lastActivityMs: latest.updatedAtMs,
        sources: ['hook'],
        host: latest.event.host,
      });
    }

    return snapshots;
  }
}
