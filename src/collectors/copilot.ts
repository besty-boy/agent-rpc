import path from 'node:path';
import type { AgentActivityState, AgentSnapshot, SessionSnapshot } from '../types.js';
import {
  emptyTokens,
  homePath,
  normalizeTimestampMs,
  ParsedFileCache,
  projectNameFromPath,
  readJsonlRecords,
  safeReadDir,
  safeStat,
  WEEK_MS,
} from './utils.js';

interface ParsedCopilotSession {
  sessionId: string;
  model?: string;
  cwd?: string;
  branch?: string;
  startedAtMs: number;
  lastActivityMs: number;
  lastState: AgentActivityState;
  lastTool?: string;
}

const copilotCache = new ParsedFileCache<ParsedCopilotSession>();

function parseCopilotEvents(
  filePath: string,
  fallbackId: string,
  fallbackMtimeMs: number,
): ParsedCopilotSession {
  const records = readJsonlRecords(filePath);
  let sessionId = fallbackId;
  let model: string | undefined;
  let cwd: string | undefined;
  let branch: string | undefined;
  let startedAtMs = fallbackMtimeMs;
  let lastActivityMs = fallbackMtimeMs;
  let lastState: AgentActivityState = 'idle';
  let lastTool: string | undefined;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const ts = normalizeTimestampMs(rec.timestamp);
    if (ts !== null) {
      if (i === 0 || ts < startedAtMs) startedAtMs = ts;
      if (ts > lastActivityMs) lastActivityMs = ts;
    }

    const type = String(rec.type ?? '');
    const data = (rec.data && typeof rec.data === 'object'
      ? rec.data
      : {}) as Record<string, unknown>;

    if (type === 'session.start') {
      if (typeof data.sessionId === 'string') sessionId = data.sessionId;
      if (typeof data.selectedModel === 'string') model = data.selectedModel;
      const startTs = normalizeTimestampMs(data.startTime);
      if (startTs !== null) startedAtMs = startTs;
      const ctx = data.context as Record<string, unknown> | undefined;
      if (typeof ctx?.cwd === 'string') cwd = ctx.cwd;
      if (typeof ctx?.branch === 'string') branch = ctx.branch;
    } else if (type === 'session.model_change') {
      if (typeof data.newModel === 'string') model = data.newModel;
    } else if (type === 'assistant.turn_start') {
      lastState = 'thinking';
    } else if (type === 'assistant.message') {
      if (typeof data.model === 'string') model = data.model;
      lastState = 'coding';
    } else if (type === 'tool.execution_start') {
      if (typeof data.toolName === 'string') lastTool = data.toolName;
      lastState = 'tool';
    } else if (type === 'tool.execution_complete') {
      lastTool = undefined;
      lastState = 'coding';
    } else if (type === 'assistant.turn_end') {
      lastTool = undefined;
      lastState = 'waiting';
    }
  }

  return {
    sessionId,
    model,
    cwd,
    branch,
    startedAtMs,
    lastActivityMs,
    lastState,
    lastTool,
  };
}

export function collectCopilot(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const copilotRoot = homePath('.copilot');
  if (!safeStat(copilotRoot)?.isDirectory()) return null;

  const sessionsDir = path.join(copilotRoot, 'session-state');
  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  let weeklySessionCount = 0;
  let activeSessionCount = 0;
  let latest: ParsedCopilotSession | null = null;
  let latestMtime = 0;

  for (const entry of safeReadDir(sessionsDir)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const eventsPath = path.join(sessionsDir, entry.name, 'events.jsonl');
    const stat = safeStat(eventsPath);
    if (!stat || !stat.isFile()) continue;

    if (stat.mtimeMs < weekCutoff && stat.mtimeMs <= latestMtime) continue;

    const parsed = copilotCache.getOrParse(eventsPath, stat, () =>
      parseCopilotEvents(eventsPath, entry.name, stat.mtimeMs),
    );
    const effectiveLastMs = Math.max(parsed.lastActivityMs, stat.mtimeMs);

    if (effectiveLastMs >= weekCutoff) weeklySessionCount += 1;
    if (effectiveLastMs >= activeCutoff) activeSessionCount += 1;
    if (!latest || effectiveLastMs > latestMtime) {
      latestMtime = effectiveLastMs;
      latest = { ...parsed, lastActivityMs: effectiveLastMs };
    }
  }

  const active = activeSessionCount > 0;
  let currentSession: SessionSnapshot | undefined;
  if (latest) {
    const state: AgentActivityState = active ? latest.lastState : 'idle';
    currentSession = {
      id: latest.sessionId,
      agentId: 'copilot',
      surface: 'cli',
      state,
      model: latest.model,
      project: projectNameFromPath(latest.cwd),
      cwd: latest.cwd,
      branch: latest.branch,
      toolName: active ? latest.lastTool : undefined,
      startedAtMs: latest.startedAtMs,
      lastActivityMs: latest.lastActivityMs,
    };
  }

  return {
    agentId: 'copilot',
    displayName: 'GitHub Copilot',
    installed: true,
    active,
    state: currentSession?.state ?? 'offline',
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens: emptyTokens(),
    weeklyTokens: emptyTokens(),
    processCount: 0,
    lastActivityMs: latestMtime,
    sources: ['copilot-events'],
  };
}
