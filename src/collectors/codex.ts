import path from 'node:path';
import type {
  AgentActivityState,
  AgentSnapshot,
  QuotaInfo,
  QuotaWindow,
  SessionSnapshot,
  TokenUsage,
} from '../types.js';
import {
  addTokens,
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

interface ParsedCodexRollout {
  sessionId: string;
  cwd?: string;
  branch?: string;
  model?: string;
  startedAtMs: number;
  lastActivityMs: number;
  tokens: TokenUsage;
  contextWindow?: number;
  contextUsedTokens?: number;
  quota?: QuotaInfo;
  inProgress: boolean;
  lastTool?: string;
}

const rolloutCache = new ParsedFileCache<ParsedCodexRollout>();

function windowLabelFromMinutes(windowMinutes: number | undefined): string {
  if (!windowMinutes || windowMinutes <= 0) return 'weekly';
  if (windowMinutes <= 480) return 'session';
  if (windowMinutes <= 1440) return 'daily';
  if (windowMinutes <= 10500) return 'weekly';
  return 'monthly';
}

function parseCodexRateLimitWindow(raw: unknown): QuotaWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const usedPercent = Number(obj.used_percent);
  if (!Number.isFinite(usedPercent)) return undefined;
  const windowMinutes = Number(obj.window_minutes) || undefined;
  const resetsAtMs = normalizeTimestampMs(obj.resets_at) ?? undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    label: windowLabelFromMinutes(windowMinutes),
    windowMinutes,
    resetsAtMs,
  };
}

function parseCodexQuota(rateLimits: unknown): QuotaInfo | undefined {
  if (!rateLimits || typeof rateLimits !== 'object') return undefined;
  const rl = rateLimits as Record<string, unknown>;
  const primary = parseCodexRateLimitWindow(rl.primary);
  const secondary = parseCodexRateLimitWindow(rl.secondary);
  const planType = typeof rl.plan_type === 'string' && rl.plan_type ? rl.plan_type : undefined;
  const creditsObj = rl.credits as Record<string, unknown> | undefined;
  const creditsBalance =
    typeof creditsObj?.balance === 'string' && creditsObj.balance ? creditsObj.balance : undefined;

  if (!primary && !secondary && !planType && !creditsBalance) return undefined;

  // If both windows exist (e.g. primary=5h session, secondary=7d weekly), map both cleanly.
  // If only primary exists (e.g. monthly or weekly cap), expose it as the headline `weekly` quota.
  if (primary && secondary) {
    const primaryShorter = (primary.windowMinutes ?? 300) <= (secondary.windowMinutes ?? 10080);
    return {
      weekly: primaryShorter ? secondary : primary,
      session: {
        ...(primaryShorter ? primary : secondary),
        label: 'session',
      },
      planType,
      creditsBalance,
    };
  }

  return {
    weekly: primary ?? secondary,
    planType,
    creditsBalance,
  };
}

function parseCodexRollout(filePath: string, fallbackMtimeMs: number): ParsedCodexRollout {
  const records = readJsonlRecords(filePath);
  let sessionId = path.basename(filePath, '.jsonl');
  let cwd: string | undefined;
  let branch: string | undefined;
  let model: string | undefined;
  let startedAtMs = fallbackMtimeMs;
  let lastActivityMs = fallbackMtimeMs;
  let tokens = emptyTokens();
  let contextWindow: number | undefined;
  let contextUsedTokens: number | undefined;
  let quota: QuotaInfo | undefined;
  let inProgress = false;
  let lastTool: string | undefined;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const ts = normalizeTimestampMs(rec.timestamp);
    if (ts !== null) {
      if (i === 0 || ts < startedAtMs) startedAtMs = ts;
      if (ts > lastActivityMs) lastActivityMs = ts;
    }

    const type = String(rec.type ?? '');
    const payload = (rec.payload && typeof rec.payload === 'object'
      ? rec.payload
      : {}) as Record<string, unknown>;

    if (type === 'session_meta') {
      if (typeof payload.session_id === 'string') sessionId = payload.session_id;
      else if (typeof payload.id === 'string') sessionId = payload.id;
      if (typeof payload.cwd === 'string') cwd = payload.cwd;
      const git = payload.git as Record<string, unknown> | undefined;
      if (typeof git?.branch === 'string') branch = git.branch;
      const ctxWin = Number(payload.context_window);
      if (Number.isFinite(ctxWin) && ctxWin > 0) contextWindow = ctxWin;
      const metaTs = normalizeTimestampMs(payload.timestamp);
      if (metaTs !== null && metaTs < startedAtMs) startedAtMs = metaTs;
    } else if (type === 'turn_context') {
      if (typeof payload.model === 'string' && payload.model) model = payload.model;
      if (typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd;
    } else if (type === 'response_item' && payload.type === 'custom_tool_call') {
      if (typeof payload.name === 'string') lastTool = payload.name;
    } else if (type === 'event_msg') {
      const sub = String(payload.type ?? '');
      if (sub === 'task_started') {
        inProgress = true;
        const ctxWin = Number(payload.model_context_window);
        if (Number.isFinite(ctxWin) && ctxWin > 0) contextWindow = ctxWin;
      } else if (sub === 'task_complete') {
        inProgress = false;
        lastTool = undefined;
      } else if (sub === 'token_count') {
        const info = payload.info as Record<string, unknown> | undefined;
        const totalUsage = info?.total_token_usage as Record<string, unknown> | undefined;
        const lastUsage = info?.last_token_usage as Record<string, unknown> | undefined;
        if (totalUsage) {
          tokens = emptyTokens();
          addTokens(tokens, {
            input: Number(totalUsage.input_tokens) || 0,
            output: Number(totalUsage.output_tokens) || 0,
            cacheRead: Number(totalUsage.cached_input_tokens) || 0,
            reasoning: Number(totalUsage.reasoning_output_tokens) || 0,
            total: Number(totalUsage.total_tokens) || 0,
          });
        }
        if (lastUsage) {
          const used =
            (Number(lastUsage.input_tokens) || 0) + (Number(lastUsage.cached_input_tokens) || 0);
          if (used > 0) contextUsedTokens = used;
        }
        const ctxWin = Number(info?.model_context_window);
        if (Number.isFinite(ctxWin) && ctxWin > 0) contextWindow = ctxWin;
        const parsedQuota = parseCodexQuota(payload.rate_limits);
        if (parsedQuota) quota = parsedQuota;
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
    contextWindow,
    contextUsedTokens,
    quota,
    inProgress,
    lastTool,
  };
}

function collectRolloutFiles(sessionsRoot: string): Array<{ filePath: string; mtimeMs: number; stat: ReturnType<typeof safeStat> }> {
  const files: Array<{ filePath: string; mtimeMs: number; stat: ReturnType<typeof safeStat> }> = [];
  // Structure: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (and possibly flat files)
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    for (const entry of safeReadDir(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = safeStat(full);
        if (stat) files.push({ filePath: full, mtimeMs: stat.mtimeMs, stat });
      }
    }
  };
  walk(sessionsRoot, 0);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

export function collectCodex(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot | null {
  const codexRoot = homePath('.codex');
  if (!safeStat(codexRoot)?.isDirectory()) return null;

  const sessionsRoot = path.join(codexRoot, 'sessions');
  const allFiles = safeStat(sessionsRoot)?.isDirectory() ? collectRolloutFiles(sessionsRoot) : [];

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;

  const weeklyTokens = emptyTokens();
  let weeklySessionCount = 0;
  let activeSessionCount = 0;
  let latest: ParsedCodexRollout | null = null;
  let latestQuota: QuotaInfo | undefined;
  let latestMtime = 0;

  // Inspect all files from the last 7 days + the very latest file even if older (for quota/installed info)
  for (let i = 0; i < allFiles.length; i++) {
    const f = allFiles[i]!;
    if (!f.stat) continue;
    if (i > 0 && f.mtimeMs < weekCutoff) break;
    if (i >= 120) break;

    const parsed = rolloutCache.getOrParse(f.filePath, f.stat, () =>
      parseCodexRollout(f.filePath, f.mtimeMs),
    );
    const effectiveLastMs = Math.max(parsed.lastActivityMs, f.mtimeMs);

    if (effectiveLastMs >= weekCutoff) {
      weeklySessionCount += 1;
      addTokens(weeklyTokens, parsed.tokens);
    }
    if (effectiveLastMs >= activeCutoff) {
      activeSessionCount += 1;
    }
    if (!latestQuota && parsed.quota) {
      latestQuota = parsed.quota;
    }
    if (!latest || effectiveLastMs > latestMtime) {
      latestMtime = effectiveLastMs;
      latest = { ...parsed, lastActivityMs: effectiveLastMs };
    }
  }

  const active = activeSessionCount > 0;
  let currentSession: SessionSnapshot | undefined;
  if (latest) {
    const state: AgentActivityState = active
      ? latest.inProgress
        ? latest.lastTool
          ? 'tool'
          : 'thinking'
        : 'coding'
      : 'idle';
    currentSession = {
      id: latest.sessionId,
      agentId: 'codex',
      surface: 'cli',
      state,
      model: latest.model,
      project: projectNameFromPath(latest.cwd),
      cwd: latest.cwd,
      branch: latest.branch,
      toolName: latest.inProgress ? latest.lastTool : undefined,
      startedAtMs: latest.startedAtMs,
      lastActivityMs: latest.lastActivityMs,
      tokens: latest.tokens,
      contextWindow: latest.contextWindow,
      contextUsedTokens: latest.contextUsedTokens,
    };
  }

  return {
    agentId: 'codex',
    displayName: 'Codex',
    installed: true,
    active,
    state: currentSession?.state ?? 'offline',
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens: latest?.tokens ?? emptyTokens(),
    weeklyTokens,
    quota: latest?.quota ?? latestQuota,
    processCount: 0,
    lastActivityMs: latestMtime,
    sources: ['rollout-jsonl'],
  };
}
