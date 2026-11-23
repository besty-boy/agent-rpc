import { getAgentMetadata } from '../registry.js';
import type { AgentId, AgentSnapshot, AppConfig, FleetSnapshot } from '../types.js';
import { collectAntigravity } from './antigravity.js';
import { collectClaude } from './claude.js';
import { collectCodex } from './codex.js';
import { collectCopilot } from './copilot.js';
import { collectCursor } from './cursor.js';
import { LiveEventStore } from './events.js';
import {
  buildProcessOnlySnapshot,
  collectGenericFileAgents,
  matchAgentProcesses,
} from './generic-agents.js';
import { collectGrok } from './grok.js';
import { collectHermes } from './hermes.js';
import { collectOpenCode } from './opencode.js';
import { collectT3Code } from './t3.js';
import { emptyTokens, listRunningProcesses } from './utils.js';
import { collectVibe } from './vibe.js';

export class AgentCollectorHub {
  readonly liveEvents = new LiveEventStore();
  /** Tracks first-seen timestamp per process-only agent so timer ticks continuously instead of resetting. */
  private processStartTimes = new Map<AgentId, number>();

  async collect(config: AppConfig, nowMs = Date.now()): Promise<FleetSnapshot> {
    const activeWindowMs = config.activeWindowMin * 60_000;
    const disabled = new Set(config.disabledAgents.map((d) => d.toLowerCase()));
    const byId = new Map<AgentId, AgentSnapshot>();

    // Kick off async process listing immediately so it runs concurrently with local file/SQLite reads
    const processesPromise = listRunningProcesses();

    const upsert = (snap: AgentSnapshot | null) => {
      if (!snap) return;
      if (disabled.has(snap.agentId.toLowerCase())) return;
      const existing = byId.get(snap.agentId);
      if (!existing) {
        byId.set(snap.agentId, snap);
        return;
      }
      byId.set(snap.agentId, mergeSnapshots(existing, snap));
    };

    // 1. Run all specialized local collectors safely
    const safeRun = <T>(fn: () => T): T | null => {
      try {
        return fn();
      } catch {
        return null;
      }
    };

    upsert(safeRun(() => collectAntigravity(activeWindowMs, nowMs)));
    upsert(safeRun(() => collectCodex(activeWindowMs, nowMs)));
    upsert(safeRun(() => collectOpenCode(activeWindowMs, nowMs)));
    upsert(safeRun(() => collectClaude(activeWindowMs, nowMs)));
    upsert(safeRun(() => collectVibe(activeWindowMs, nowMs)));
    upsert(safeRun(() => collectCopilot(activeWindowMs, nowMs)));
    upsert(safeRun(() => collectHermes(activeWindowMs, nowMs)));
    upsert(safeRun(() => collectGrok(activeWindowMs, nowMs)));
    upsert(safeRun(() => collectCursor(activeWindowMs, nowMs)));

    const genericSnaps = safeRun(() => collectGenericFileAgents(activeWindowMs, nowMs)) ?? [];
    for (const s of genericSnaps) upsert(s);

    // 2. Run T3 Code orchestrator collector and enrich underlying active providers (e.g. Antigravity, Codex, Vibe)
    const t3Result = safeRun(() => collectT3Code(activeWindowMs, nowMs));
    if (t3Result) {
      upsert(t3Result.t3Snapshot);
      for (const [agentId, enrich] of t3Result.enrichments) {
        if (disabled.has(agentId.toLowerCase()) || agentId === 't3') continue;
        const existing = byId.get(agentId);
        if (existing) {
          if (enrich.active) {
            existing.active = true;
            if (enrich.state === 'thinking') existing.state = 'thinking';
            existing.activeSessionCount = Math.max(
              existing.activeSessionCount,
              enrich.activeRunCount + enrich.activeSubagentCount,
            );
          }
          if (enrich.lastActivityMs > existing.lastActivityMs) {
            existing.lastActivityMs = enrich.lastActivityMs;
          }
          if (!existing.host && enrich.active) {
            existing.host = 'T3 Code';
          }
          if (!existing.sources.includes('t3-orchestrator')) {
            existing.sources.push('t3-orchestrator');
          }
          if (existing.currentSession) {
            if (!existing.currentSession.project && enrich.project) {
              existing.currentSession.project = enrich.project;
            }
            if (!existing.currentSession.cwd && enrich.cwd) {
              existing.currentSession.cwd = enrich.cwd;
            }
            if (!existing.currentSession.model && enrich.model) {
              existing.currentSession.model = enrich.model;
            }
            if (enrich.state === 'thinking' && enrich.active) {
              existing.currentSession.state = 'thinking';
            }
          } else {
            existing.currentSession = {
              id: `t3-${agentId}`,
              agentId,
              surface: 't3',
              state: enrich.state,
              model: enrich.model,
              project: enrich.project,
              cwd: enrich.cwd,
              startedAtMs: enrich.startedAtMs,
              lastActivityMs: enrich.lastActivityMs,
            };
          }
        } else {
          const meta = getAgentMetadata(agentId, config.customAgents);
          byId.set(agentId, {
            agentId,
            displayName: meta.displayName,
            installed: true,
            active: enrich.active,
            state: enrich.state,
            currentSession: {
              id: `t3-${agentId}`,
              agentId,
              surface: 't3',
              state: enrich.state,
              model: enrich.model,
              project: enrich.project,
              cwd: enrich.cwd,
              startedAtMs: enrich.startedAtMs,
              lastActivityMs: enrich.lastActivityMs,
            },
            activeSessionCount: enrich.active ? enrich.activeRunCount + enrich.activeSubagentCount : 0,
            weeklySessionCount: 1,
            sessionTokens: emptyTokens(),
            weeklyTokens: emptyTokens(),
            processCount: 0,
            lastActivityMs: enrich.lastActivityMs,
            sources: ['t3-orchestrator'],
            host: 'T3 Code',
          });
        }
      }
    }

    // 3. Overlay real-time hook / push API events (highest freshness!)
    const hookSnaps = this.liveEvents.getSnapshots(config.customAgents, nowMs);
    for (const hookSnap of hookSnaps) {
      upsert(hookSnap);
    }

    // 4. Overlay OS process scanner (detects running agents even without disk logs)
    const processes = await processesPromise;
    const procCounts = matchAgentProcesses(processes, config.customAgents);
    const activeProcIds = new Set<AgentId>();

    for (const [agentId, count] of procCounts) {
      if (disabled.has(agentId.toLowerCase())) continue;
      activeProcIds.add(agentId);
      if (!this.processStartTimes.has(agentId)) {
        this.processStartTimes.set(agentId, nowMs);
      }
      const firstSeenMs = this.processStartTimes.get(agentId) ?? nowMs;
      const existing = byId.get(agentId);
      if (existing) {
        existing.processCount = count;
        if (!existing.sources.includes('process')) existing.sources.push('process');
        // Note: a running GUI app like Cursor/T3/Antigravity counts as active if it's running
        // and either has no recent log file or is a live CLI process.
        if (!existing.active && agentId !== 't3') {
          // For CLI agents (codex, claude, opencode, vibe, grok, aider, etc.) a live process means actively running.
          // For full desktop IDEs that people leave open idle in the background, still mark active if running!
          existing.active = true;
          existing.state = existing.state === 'offline' ? 'coding' : existing.state;
          existing.activeSessionCount = Math.max(1, existing.activeSessionCount);
          if (!existing.currentSession) {
            existing.currentSession = {
              id: `${agentId}-process`,
              agentId,
              surface: 'process',
              state: 'coding',
              startedAtMs: firstSeenMs,
              lastActivityMs: nowMs,
            };
          }
        }
      } else {
        const snap = buildProcessOnlySnapshot(agentId, count, config.customAgents, firstSeenMs);
        snap.lastActivityMs = nowMs;
        if (snap.currentSession) snap.currentSession.lastActivityMs = nowMs;
        byId.set(agentId, snap);
      }
    }

    // Drop start times for processes that exited
    for (const trackedId of [...this.processStartTimes.keys()]) {
      if (!activeProcIds.has(trackedId)) {
        this.processStartTimes.delete(trackedId);
      }
    }

    // 5. Sort all agents cleanly (active first, then priority/recency)
    const priorityMap = new Map<string, number>();
    config.agentPriority.forEach((id, idx) => priorityMap.set(id, idx));

    const agents = [...byId.values()].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      // Prefer agents with live hooks or actual recent log activity over pure orchestrator host (`t3`)
      const aScore = activityWeight(a, nowMs, priorityMap);
      const bScore = activityWeight(b, nowMs, priorityMap);
      return bScore - aScore;
    });

    const activeAgents = agents.filter((a) => a.active);
    // Avoid double-counting T3 orchestrator sessions when a child provider inside T3 is already counted
    const nonOrchestratorActive = activeAgents.filter((a) => a.agentId !== 't3');
    const sessionCounterList = nonOrchestratorActive.length > 0 ? nonOrchestratorActive : activeAgents;
    const totalActiveSessions = sessionCounterList.reduce(
      (sum, a) => sum + Math.max(1, a.activeSessionCount),
      0,
    );

    const totalWeeklyTokens = agents.reduce((sum, a) => sum + a.weeklyTokens.total, 0);
    const totalWeeklyCostUsd = agents.reduce((sum, a) => sum + (a.weeklyCostUsd ?? 0), 0);

    // 6. Pick primary agent:
    //    - Prefer an active non-orchestrator agent (e.g. Antigravity instead of generic T3 wrapper)
    //    - Else any active agent
    //    - Else most recently active agent within `idleGraceMin`
    let primaryAgent: AgentSnapshot | undefined = nonOrchestratorActive[0] ?? activeAgents[0];
    if (!primaryAgent && config.idleGraceMin > 0) {
      const graceCutoff = nowMs - config.idleGraceMin * 60_000;
      const recent = agents.find((a) => a.agentId !== 't3' && a.lastActivityMs >= graceCutoff) ??
        agents.find((a) => a.lastActivityMs >= graceCutoff);
      if (recent) primaryAgent = recent;
    }

    return {
      collectedAtMs: nowMs,
      agents,
      activeAgents,
      primaryAgent,
      totalActiveSessions,
      totalInstalledAgents: agents.length,
      totalWeeklyTokens,
      totalWeeklyCostUsd,
    };
  }
}

function activityWeight(
  snap: AgentSnapshot,
  nowMs: number,
  priorityMap: Map<string, number>,
): number {
  let score = 0;
  if (snap.active) score += 1_000_000;
  if (snap.sources.includes('hook') && snap.active) score += 250_000;
  if (snap.state === 'thinking' || snap.state === 'tool') score += 150_000;
  // T3 Code is an orchestrator host; let the actual agent running inside it take top billing
  if (snap.agentId === 't3') score -= 200_000;
  // Recency boost (decays smoothly over 24h)
  if (snap.lastActivityMs > 0) {
    const ageSec = Math.max(0, (nowMs - snap.lastActivityMs) / 1000);
    score += Math.max(0, 100_000 - ageSec * 10);
  }
  // Small tie-breaker from configured priority
  const prio = priorityMap.get(snap.agentId);
  if (prio !== undefined) {
    score += Math.max(0, 500 - prio * 10);
  }
  return score;
}

function mergeSnapshots(base: AgentSnapshot, incoming: AgentSnapshot): AgentSnapshot {
  const incomingFresher =
    incoming.sources.includes('hook') || incoming.lastActivityMs >= base.lastActivityMs;
  const primary = incomingFresher ? incoming : base;
  const secondary = incomingFresher ? base : incoming;

  const mergedSession = primary.currentSession
    ? {
        ...secondary.currentSession,
        ...primary.currentSession,
        model: primary.currentSession.model ?? secondary.currentSession?.model,
        project: primary.currentSession.project ?? secondary.currentSession?.project,
        cwd: primary.currentSession.cwd ?? secondary.currentSession?.cwd,
        branch: primary.currentSession.branch ?? secondary.currentSession?.branch,
        startedAtMs: Math.min(
          primary.currentSession.startedAtMs,
          secondary.currentSession?.startedAtMs ?? primary.currentSession.startedAtMs,
        ),
      }
    : secondary.currentSession;

  return {
    ...secondary,
    ...primary,
    installed: base.installed || incoming.installed,
    active: base.active || incoming.active,
    state: primary.active ? primary.state : secondary.state,
    currentSession: mergedSession,
    activeSessionCount: Math.max(base.activeSessionCount, incoming.activeSessionCount),
    weeklySessionCount: Math.max(base.weeklySessionCount, incoming.weeklySessionCount),
    sessionTokens:
      primary.sessionTokens.total >= secondary.sessionTokens.total
        ? primary.sessionTokens
        : secondary.sessionTokens,
    weeklyTokens:
      primary.weeklyTokens.total >= secondary.weeklyTokens.total
        ? primary.weeklyTokens
        : secondary.weeklyTokens,
    sessionCostUsd: primary.sessionCostUsd ?? secondary.sessionCostUsd,
    weeklyCostUsd: primary.weeklyCostUsd ?? secondary.weeklyCostUsd,
    quota: primary.quota ?? secondary.quota,
    processCount: Math.max(base.processCount, incoming.processCount),
    lastActivityMs: Math.max(base.lastActivityMs, incoming.lastActivityMs),
    sources: [...new Set([...base.sources, ...incoming.sources])],
    host: primary.host ?? secondary.host,
  };
}
