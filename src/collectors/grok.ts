import path from 'node:path';
import type { AgentActivityState, AgentSnapshot, SessionSnapshot } from '../types.js';
import {
  emptyTokens,
  homePath,
  projectNameFromPath,
  readJsonFile,
  safeReadDir,
  safeStat,
  WEEK_MS,
} from './utils.js';

interface GrokPromptContext {
  working_directory?: string;
  model?: string;
}

export function collectGrok(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const grokRoot = homePath('.grok');
  if (!safeStat(grokRoot)?.isDirectory()) return null;

  const activeJson = readJsonFile<unknown[]>(path.join(grokRoot, 'active_sessions.json'));
  const activeFromFile = Array.isArray(activeJson) ? activeJson.length : 0;

  const sessionsRoot = path.join(grokRoot, 'sessions');
  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  let weeklySessionCount = 0;
  let activeSessionCount = activeFromFile;
  let latestMtime = 0;
  let latestSessionId = 'grok-session';
  let latestCwd: string | undefined;
  let latestModel: string | undefined;

  for (const projEntry of safeReadDir(sessionsRoot)) {
    if (!projEntry.isDirectory()) continue;
    let decodedDir: string | undefined;
    try {
      decodedDir = decodeURIComponent(projEntry.name);
    } catch {
      decodedDir = undefined;
    }

    const projPath = path.join(sessionsRoot, projEntry.name);
    for (const sessEntry of safeReadDir(projPath)) {
      if (!sessEntry.isDirectory()) continue;
      const sessDir = path.join(projPath, sessEntry.name);
      const chatStat =
        safeStat(path.join(sessDir, 'chat_history.jsonl')) ??
        safeStat(path.join(sessDir, 'events.jsonl')) ??
        safeStat(sessDir);
      if (!chatStat) continue;

      if (chatStat.mtimeMs >= weekCutoff) weeklySessionCount += 1;
      if (chatStat.mtimeMs >= activeCutoff) activeSessionCount = Math.max(activeSessionCount, 1);

      if (chatStat.mtimeMs > latestMtime) {
        latestMtime = chatStat.mtimeMs;
        latestSessionId = sessEntry.name;
        const ctx = readJsonFile<GrokPromptContext>(path.join(sessDir, 'prompt_context.json'));
        latestCwd = ctx?.working_directory ?? decodedDir;
        latestModel = ctx?.model;
      }
    }
  }

  const active = activeSessionCount > 0;
  const state: AgentActivityState = active ? 'coding' : latestMtime > 0 ? 'idle' : 'offline';
  const currentSession: SessionSnapshot | undefined = latestMtime
    ? {
        id: latestSessionId,
        agentId: 'grok',
        surface: 'cli',
        state,
        model: latestModel,
        project: projectNameFromPath(latestCwd),
        cwd: latestCwd,
        startedAtMs: latestMtime,
        lastActivityMs: latestMtime,
      }
    : undefined;

  return {
    agentId: 'grok',
    displayName: 'Grok CLI',
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
    sources: ['grok-sessions'],
  };
}
