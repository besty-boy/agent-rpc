import type { AgentActivityState, AgentSnapshot, SessionSnapshot, TokenUsage } from '../types.js';
import {
  addTokens,
  emptyTokens,
  homePath,
  normalizeTimestampMs,
  ParsedFileCache,
  projectNameFromPath,
  readJsonFile,
  safeStat,
  WEEK_MS,
} from './utils.js';

const vibeIndexCache = new ParsedFileCache<VibeIndexFile | null>(4);

interface VibeTokenBlock {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
}

interface VibeIndexEntry {
  session_id?: string;
  metadata?: {
    active_model?: string;
    agent_name?: string;
    cwd?: string;
    completion_catalogue?: string;
  };
  session?: {
    id?: string;
    createdAt?: number | string;
    updatedAt?: number | string;
    status?: { type?: string };
    tokenUsage?: VibeTokenBlock;
    contextUsage?: VibeTokenBlock;
  };
}

interface VibeIndexFile {
  entries?: VibeIndexEntry[] | Record<string, VibeIndexEntry>;
}

function parseVibeContextWindow(catalogueRaw: string | undefined): number | undefined {
  if (!catalogueRaw) return undefined;
  try {
    const obj = JSON.parse(catalogueRaw) as { context_window?: number };
    return typeof obj.context_window === 'number' && obj.context_window > 0
      ? obj.context_window
      : undefined;
  } catch {
    return undefined;
  }
}

function parseVibeTokens(block: VibeTokenBlock | undefined): TokenUsage {
  const t = emptyTokens();
  if (!block) return t;
  addTokens(t, {
    input: block.inputTokens ?? 0,
    output: block.outputTokens ?? 0,
    cacheRead: block.cachedInputTokens ?? 0,
    total: block.totalTokens ?? 0,
  });
  return t;
}

export function collectVibe(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const vibeRoot = homePath('.vibe');
  if (!safeStat(vibeRoot)?.isDirectory()) return null;

  const indexPath = homePath('.vibe', 'logs', 'session', 'unified', '.session-index.json');
  const indexStat = safeStat(indexPath);
  const indexData = indexStat
    ? vibeIndexCache.getOrParse(indexPath, indexStat, () => readJsonFile<VibeIndexFile>(indexPath))
    : null;
  const rawEntries = indexData?.entries;
  const entries: VibeIndexEntry[] = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries && typeof rawEntries === 'object'
      ? Object.values(rawEntries)
      : [];

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  const weeklyTokens = emptyTokens();
  let weeklySessionCount = 0;
  let activeSessionCount = 0;
  let latestEntry: VibeIndexEntry | null = null;
  let latestUpdatedMs = 0;

  for (const entry of entries) {
    const updatedMs = normalizeTimestampMs(entry.session?.updatedAt) ?? 0;
    if (updatedMs >= weekCutoff) {
      weeklySessionCount += 1;
      addTokens(weeklyTokens, parseVibeTokens(entry.session?.tokenUsage));
    }
    const statusType = entry.session?.status?.type;
    const isRunning = statusType === 'running' || statusType === 'streaming' || statusType === 'busy';
    if (isRunning || updatedMs >= activeCutoff) {
      activeSessionCount += 1;
    }
    if (updatedMs > latestUpdatedMs) {
      latestUpdatedMs = updatedMs;
      latestEntry = entry;
    }
  }

  const active = activeSessionCount > 0;
  const sessionTokens = parseVibeTokens(latestEntry?.session?.tokenUsage);
  const contextTokens = parseVibeTokens(latestEntry?.session?.contextUsage);
  const contextWindow = parseVibeContextWindow(latestEntry?.metadata?.completion_catalogue);

  let currentSession: SessionSnapshot | undefined;
  if (latestEntry) {
    const statusType = latestEntry.session?.status?.type;
    const state: AgentActivityState = !active
      ? 'idle'
      : statusType === 'running' || statusType === 'streaming'
        ? 'thinking'
        : 'coding';
    const createdMs = normalizeTimestampMs(latestEntry.session?.createdAt) ?? latestUpdatedMs;
    currentSession = {
      id: latestEntry.session_id ?? latestEntry.session?.id ?? 'vibe-session',
      agentId: 'vibe',
      surface: 'cli',
      state,
      model: latestEntry.metadata?.active_model,
      project: projectNameFromPath(latestEntry.metadata?.cwd),
      cwd: latestEntry.metadata?.cwd,
      startedAtMs: createdMs,
      lastActivityMs: latestUpdatedMs,
      tokens: sessionTokens,
      contextWindow,
      contextUsedTokens: contextTokens.total || undefined,
    };
  }

  return {
    agentId: 'vibe',
    displayName: 'Mistral Vibe',
    installed: true,
    active,
    state: currentSession?.state ?? 'offline',
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens,
    weeklyTokens,
    processCount: 0,
    lastActivityMs: latestUpdatedMs,
    sources: ['vibe-index'],
  };
}
