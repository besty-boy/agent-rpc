import path from 'node:path';
import type { AgentActivityState, AgentSnapshot, SessionSnapshot, TokenUsage } from '../types.js';
import {
  addTokens,
  emptyTokens,
  FIVE_HOURS_MS,
  homePath,
  normalizeTimestampMs,
  ParsedFileCache,
  projectNameFromPath,
  readJsonlRecords,
  safeReadDir,
  safeStat,
  WEEK_MS,
} from './utils.js';

interface ParsedClaudeSession {
  sessionId: string;
  cwd?: string;
  branch?: string;
  model?: string;
  startedAtMs: number;
  lastActivityMs: number;
  tokens: TokenUsage;
  tokensLast5h: TokenUsage;
  lastState: AgentActivityState;
  lastTool?: string;
}

const claudeCache = new ParsedFileCache<ParsedClaudeSession>();

function parseClaudeJsonl(
  filePath: string,
  fallbackMtimeMs: number,
  fiveHourCutoff: number,
): ParsedClaudeSession {
  const records = readJsonlRecords(filePath);
  let sessionId = path.basename(filePath, '.jsonl');
  let cwd: string | undefined;
  let branch: string | undefined;
  let model: string | undefined;
  let startedAtMs = fallbackMtimeMs;
  let lastActivityMs = fallbackMtimeMs;
  const tokens = emptyTokens();
  const tokensLast5h = emptyTokens();
  let lastState: AgentActivityState = 'idle';
  let lastTool: string | undefined;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const ts = normalizeTimestampMs(rec.timestamp);
    if (ts !== null) {
      if (i === 0 || ts < startedAtMs) startedAtMs = ts;
      if (ts > lastActivityMs) lastActivityMs = ts;
    }

    if (typeof rec.sessionId === 'string' && rec.sessionId) sessionId = rec.sessionId;
    if (typeof rec.cwd === 'string' && rec.cwd) cwd = rec.cwd;
    if (typeof rec.gitBranch === 'string' && rec.gitBranch) branch = rec.gitBranch;

    const type = String(rec.type ?? '');
    if (type === 'user') {
      lastState = 'thinking';
      lastTool = undefined;
    } else if (type === 'assistant' && rec.message && typeof rec.message === 'object') {
      const msg = rec.message as Record<string, unknown>;
      if (typeof msg.model === 'string' && msg.model && msg.model !== '<synthetic>') {
        model = msg.model;
      }
      if (msg.usage && typeof msg.usage === 'object') {
        const u = msg.usage as Record<string, unknown>;
        const delta = {
          input: Number(u.input_tokens) || 0,
          output: Number(u.output_tokens) || 0,
          cacheRead: Number(u.cache_read_input_tokens) || 0,
          cacheWrite: Number(u.cache_creation_input_tokens) || 0,
        };
        addTokens(tokens, delta);
        if ((ts ?? fallbackMtimeMs) >= fiveHourCutoff) {
          addTokens(tokensLast5h, delta);
        }
      }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'tool_use') {
            const name = (block as Record<string, unknown>).name;
            if (typeof name === 'string') {
              lastTool = name;
              lastState = 'tool';
            }
          }
        }
      }
      if (msg.stop_reason === 'end_turn') {
        lastState = 'waiting';
        lastTool = undefined;
      } else if (msg.stop_reason === 'tool_use') {
        lastState = 'tool';
      } else {
        lastState = 'coding';
      }
    }
  }

  return {
    sessionId,
    cwd,
    branch,
    model,
    startedAtMs,
    lastActivityMs,
    tokens,
    tokensLast5h,
    lastState,
    lastTool,
  };
}

export function collectClaude(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const claudeRoot = homePath('.claude');
  if (!safeStat(claudeRoot)?.isDirectory()) return null;

  const projectsDir = path.join(claudeRoot, 'projects');
  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;
  const fiveHourCutoff = nowMs - FIVE_HOURS_MS;

  const files: Array<{ filePath: string; stat: NonNullable<ReturnType<typeof safeStat>> }> = [];
  if (safeStat(projectsDir)?.isDirectory()) {
    for (const projEntry of safeReadDir(projectsDir)) {
      if (!projEntry.isDirectory()) continue;
      const projPath = path.join(projectsDir, projEntry.name);
      for (const fileEntry of safeReadDir(projPath)) {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith('.jsonl')) continue;
        const full = path.join(projPath, fileEntry.name);
        const stat = safeStat(full);
        if (stat) files.push({ filePath: full, stat });
      }
    }
  }
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const weeklyTokens = emptyTokens();
  const rolling5hTokens = emptyTokens();
  let weeklySessionCount = 0;
  let activeSessionCount = 0;
  let latest: ParsedClaudeSession | null = null;
  let latestMtime = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    if (i > 0 && f.stat.mtimeMs < weekCutoff) break;
    if (i >= 120) break;

    const parsed = claudeCache.getOrParse(f.filePath, f.stat, () =>
      parseClaudeJsonl(f.filePath, f.stat.mtimeMs, fiveHourCutoff),
    );
    const effectiveLastMs = Math.max(parsed.lastActivityMs, f.stat.mtimeMs);

    if (effectiveLastMs >= weekCutoff) {
      weeklySessionCount += 1;
      addTokens(weeklyTokens, parsed.tokens);
    }
    if (effectiveLastMs >= fiveHourCutoff) {
      addTokens(rolling5hTokens, parsed.tokensLast5h);
    }
    if (effectiveLastMs >= activeCutoff) {
      activeSessionCount += 1;
    }
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
      agentId: 'claude',
      surface: 'cli',
      state,
      model: latest.model,
      project: projectNameFromPath(latest.cwd),
      cwd: latest.cwd,
      branch: latest.branch,
      toolName: active ? latest.lastTool : undefined,
      startedAtMs: latest.startedAtMs,
      lastActivityMs: latest.lastActivityMs,
      tokens: latest.tokens,
    };
  }

  return {
    agentId: 'claude',
    displayName: 'Claude Code',
    installed: true,
    active,
    state: currentSession?.state ?? 'offline',
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens: rolling5hTokens.total > 0 ? rolling5hTokens : (latest?.tokens ?? emptyTokens()),
    weeklyTokens,
    processCount: 0,
    lastActivityMs: latestMtime,
    sources: ['claude-jsonl'],
  };
}
