import path from 'node:path';
import type { AgentActivityState, AgentSnapshot, SessionSnapshot, TokenUsage } from '../types.js';
import {
  addTokens,
  emptyTokens,
  homePath,
  normalizeTimestampMs,
  ParsedFileCache,
  readJsonlRecords,
  safeReadDir,
  safeStat,
  WEEK_MS,
} from './utils.js';

interface ParsedAntigravityTranscript {
  sessionId: string;
  surface: string;
  startedAtMs: number;
  lastActivityMs: number;
  model?: string;
  lastTool?: string;
  lastState: AgentActivityState;
  tokens: TokenUsage;
  lastContextTokens: number;
}

const transcriptCache = new ParsedFileCache<ParsedAntigravityTranscript>();

function discoverBrainRoots(): Array<{ dir: string; surface: string }> {
  const roots: Array<{ dir: string; surface: string }> = [
    { dir: homePath('.gemini', 'antigravity', 'brain'), surface: 'ide' },
    { dir: homePath('.gemini', 'antigravity-cli', 'brain'), surface: 'cli' },
    { dir: homePath('.gemini', 'antigravity-ide', 'brain'), surface: 'ide' },
  ];

  // T3 Code Antigravity ACP provider folders: ~/.t3/userdata/providers/antigravity/<hash>/antigravity-acp/brain
  const t3AntigravityBase = homePath('.t3', 'userdata', 'providers', 'antigravity');
  for (const entry of safeReadDir(t3AntigravityBase)) {
    if (!entry.isDirectory()) continue;
    const acpBrain = path.join(t3AntigravityBase, entry.name, 'antigravity-acp', 'brain');
    if (safeStat(acpBrain)?.isDirectory()) {
      roots.push({ dir: acpBrain, surface: 't3-acp' });
    }
  }

  return roots.filter((r) => safeStat(r.dir)?.isDirectory());
}

function parseTranscript(filePath: string, sessionId: string, surface: string, fallbackMtimeMs: number): ParsedAntigravityTranscript {
  const records = readJsonlRecords(filePath);
  const tokens = emptyTokens();
  let startedAtMs = fallbackMtimeMs;
  let lastActivityMs = fallbackMtimeMs;
  let model: string | undefined;
  let lastTool: string | undefined;
  let lastState: AgentActivityState = 'idle';
  let lastContextTokens = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const ts = normalizeTimestampMs(rec.created_at);
    if (ts !== null) {
      if (i === 0 || ts < startedAtMs) startedAtMs = ts;
      if (ts > lastActivityMs) lastActivityMs = ts;
    }

    if (typeof rec.model === 'string' && rec.model.trim()) {
      model = rec.model.trim();
    }

    const input = Number(rec.input_tokens) || 0;
    const cacheRead = Number(rec.cache_read_tokens) || 0;
    const output = Number(rec.output_tokens) || 0;
    if (input > 0 || cacheRead > 0 || output > 0) {
      addTokens(tokens, { input, cacheRead, output });
      lastContextTokens = input + cacheRead;
    }

    const type = String(rec.type ?? '');
    const status = String(rec.status ?? '');
    if (type === 'PLANNER_RESPONSE') {
      const toolCalls = Array.isArray(rec.tool_calls) ? rec.tool_calls : [];
      if (toolCalls.length > 0) {
        const lastCall = toolCalls[toolCalls.length - 1] as Record<string, unknown> | undefined;
        const name = typeof lastCall?.name === 'string' ? lastCall.name : undefined;
        lastTool = name;
        lastState = status === 'DONE' ? 'coding' : 'tool';
      } else {
        lastTool = undefined;
        lastState = status === 'DONE' ? 'thinking' : 'thinking';
      }
    } else if (type === 'USER_INPUT') {
      lastState = 'thinking';
    }
  }

  return {
    sessionId,
    surface,
    startedAtMs,
    lastActivityMs,
    model,
    lastTool,
    lastState,
    tokens,
    lastContextTokens,
  };
}

export function collectAntigravity(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const roots = discoverBrainRoots();
  const hasAnyDir =
    roots.length > 0 ||
    Boolean(safeStat(homePath('.gemini', 'antigravity'))) ||
    Boolean(safeStat(homePath('.antigravity-ide')));

  if (!hasAnyDir) return null;

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  const weeklyTokens = emptyTokens();
  let weeklySessionCount = 0;
  let activeSessionCount = 0;
  let latest: ParsedAntigravityTranscript | null = null;
  let latestMtime = 0;

  for (const root of roots) {
    for (const convDir of safeReadDir(root.dir)) {
      if (!convDir.isDirectory() || convDir.name.startsWith('.')) continue;
      const transcriptPath = path.join(root.dir, convDir.name, '.system_generated', 'logs', 'transcript.jsonl');
      const stat = safeStat(transcriptPath);
      if (!stat || !stat.isFile()) continue;

      const isRecent = stat.mtimeMs >= weekCutoff;
      const isNewerThanLatest = stat.mtimeMs > latestMtime;
      if (!isRecent && !isNewerThanLatest) continue;

      const parsed = transcriptCache.getOrParse(transcriptPath, stat, () =>
        parseTranscript(transcriptPath, convDir.name, root.surface, stat.mtimeMs),
      );
      const effectiveLastMs = Math.max(parsed.lastActivityMs, stat.mtimeMs);

      if (effectiveLastMs >= weekCutoff) {
        weeklySessionCount += 1;
        addTokens(weeklyTokens, parsed.tokens);
      }
      if (effectiveLastMs >= activeCutoff) {
        activeSessionCount += 1;
      }
      if (effectiveLastMs > latestMtime) {
        latestMtime = effectiveLastMs;
        latest = { ...parsed, lastActivityMs: effectiveLastMs };
      }
    }
  }

  const active = activeSessionCount > 0;
  let currentSession: SessionSnapshot | undefined;
  if (latest) {
    const isVeryFresh = nowMs - latest.lastActivityMs < 45_000;
    const state: AgentActivityState = active
      ? isVeryFresh
        ? latest.lastState
        : 'coding'
      : 'idle';
    currentSession = {
      id: latest.sessionId,
      agentId: 'antigravity',
      surface: latest.surface,
      state,
      model: latest.model,
      toolName: isVeryFresh ? latest.lastTool : undefined,
      startedAtMs: latest.startedAtMs,
      lastActivityMs: latest.lastActivityMs,
      tokens: latest.tokens,
      contextUsedTokens: latest.lastContextTokens || undefined,
    };
  }

  return {
    agentId: 'antigravity',
    displayName: 'Antigravity',
    installed: true,
    active,
    state: currentSession?.state ?? 'offline',
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens: latest?.tokens ?? emptyTokens(),
    weeklyTokens,
    processCount: 0,
    lastActivityMs: latestMtime,
    sources: ['transcript'],
    host: latest?.surface === 't3-acp' ? 'T3 Code' : undefined,
  };
}
