import path from 'node:path';
import { BUILTIN_AGENTS, getAgentMetadata } from '../registry.js';
import type {
  AgentId,
  AgentSnapshot,
  CustomAgentRule,
  SessionSnapshot,
  TokenUsage,
} from '../types.js';
import {
  addTokens,
  emptyTokens,
  homePath,
  readJsonFile,
  type RunningProcess,
  safeReadDir,
  safeStat,
  WEEK_MS,
} from './utils.js';

const BUILTIN_PROCESS_MATCHERS: Array<{ id: AgentId; regexes: RegExp[] }> = Object.values(
  BUILTIN_AGENTS,
)
  .filter((meta) => meta.processPatterns.length > 0)
  .map((meta) => ({
    id: meta.id,
    regexes: meta.processPatterns.map((p) => new RegExp(p, 'i')),
  }));

function vscodeGlobalStoragePaths(extensionId: string): string[] {
  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push(
      homePath('Library', 'Application Support', 'Code', 'User', 'globalStorage', extensionId),
      homePath('Library', 'Application Support', 'Cursor', 'User', 'globalStorage', extensionId),
      homePath('Library', 'Application Support', 'Windsurf', 'User', 'globalStorage', extensionId),
    );
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? homePath('AppData', 'Roaming');
    candidates.push(
      path.join(appData, 'Code', 'User', 'globalStorage', extensionId),
      path.join(appData, 'Cursor', 'User', 'globalStorage', extensionId),
    );
  } else {
    candidates.push(
      homePath('.config', 'Code', 'User', 'globalStorage', extensionId),
      homePath('.config', 'Cursor', 'User', 'globalStorage', extensionId),
    );
  }
  return candidates.filter((p) => safeStat(p)?.isDirectory());
}

function collectVscodeAgentExtension(
  agentId: AgentId,
  displayName: string,
  extensionId: string,
  activeWindowMs: number,
  nowMs: number,
): AgentSnapshot | null {
  const roots = vscodeGlobalStoragePaths(extensionId);
  if (roots.length === 0) return null;

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;
  let latestMtime = 0;
  let activeSessionCount = 0;
  let weeklySessionCount = 0;
  const weeklyTokens = emptyTokens();
  const sessionTokens = emptyTokens();

  for (const root of roots) {
    const tasksDir = path.join(root, 'tasks');
    for (const taskEntry of safeReadDir(tasksDir)) {
      if (!taskEntry.isDirectory()) continue;
      const taskDir = path.join(tasksDir, taskEntry.name);
      const uiPath = path.join(taskDir, 'ui_messages.json');
      const histPath = path.join(taskDir, 'api_conversation_history.json');
      const stat = safeStat(uiPath) ?? safeStat(histPath) ?? safeStat(taskDir);
      if (!stat) continue;

      if (stat.mtimeMs >= weekCutoff) weeklySessionCount += 1;
      if (stat.mtimeMs >= activeCutoff) activeSessionCount += 1;
      if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
    }
  }

  const active = activeSessionCount > 0;
  const currentSession: SessionSnapshot | undefined = latestMtime
    ? {
        id: `${agentId}-task`,
        agentId,
        surface: 'vscode',
        state: active ? 'coding' : 'idle',
        startedAtMs: latestMtime,
        lastActivityMs: latestMtime,
        tokens: sessionTokens,
      }
    : undefined;

  return {
    agentId,
    displayName,
    installed: true,
    active,
    state: currentSession?.state ?? 'offline',
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens,
    weeklyTokens,
    processCount: 0,
    lastActivityMs: latestMtime,
    sources: ['vscode-tasks'],
  };
}

function collectGeminiCli(activeWindowMs: number, nowMs: number): AgentSnapshot | null {
  const tmpDir = homePath('.gemini', 'tmp');
  if (!safeStat(tmpDir)?.isDirectory()) return null;

  const weekCutoff = nowMs - WEEK_MS;
  const activeCutoff = nowMs - activeWindowMs;
  const weeklyTokens = emptyTokens();
  let sessionTokens = emptyTokens();
  let latestMtime = 0;
  let latestModel: string | undefined;
  let weeklySessionCount = 0;
  let activeSessionCount = 0;

  for (const projEntry of safeReadDir(tmpDir)) {
    if (!projEntry.isDirectory()) continue;
    const chatsDir = path.join(tmpDir, projEntry.name, 'chats');
    for (const chatEntry of safeReadDir(chatsDir)) {
      if (!chatEntry.isFile() || !chatEntry.name.endsWith('.json')) continue;
      const full = path.join(chatsDir, chatEntry.name);
      const stat = safeStat(full);
      if (!stat) continue;

      if (stat.mtimeMs < weekCutoff && stat.mtimeMs <= latestMtime) continue;
      if (stat.mtimeMs >= weekCutoff) weeklySessionCount += 1;
      if (stat.mtimeMs >= activeCutoff) activeSessionCount += 1;

      const parsed = readJsonFile<{
        messages?: Array<{
          model?: string;
          tokens?: { input?: number; output?: number; cached?: number; thoughts?: number; total?: number };
        }>;
      }>(full);

      const fileTokens = emptyTokens();
      let fileModel: string | undefined;
      if (Array.isArray(parsed?.messages)) {
        for (const msg of parsed.messages) {
          if (typeof msg.model === 'string' && msg.model) fileModel = msg.model;
          if (msg.tokens) {
            addTokens(fileTokens, {
              input: msg.tokens.input ?? 0,
              output: msg.tokens.output ?? 0,
              cacheRead: msg.tokens.cached ?? 0,
              reasoning: msg.tokens.thoughts ?? 0,
              total: msg.tokens.total ?? 0,
            });
          }
        }
      }

      if (stat.mtimeMs >= weekCutoff) {
        addTokens(weeklyTokens, fileTokens);
      }
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestModel = fileModel;
        sessionTokens = fileTokens;
      }
    }
  }

  const active = activeSessionCount > 0;
  const currentSession: SessionSnapshot | undefined = latestMtime
    ? {
        id: 'gemini-cli',
        agentId: 'gemini',
        surface: 'cli',
        state: active ? 'coding' : 'idle',
        model: latestModel,
        startedAtMs: latestMtime,
        lastActivityMs: latestMtime,
        tokens: sessionTokens,
      }
    : undefined;

  return {
    agentId: 'gemini',
    displayName: 'Gemini CLI',
    installed: true,
    active,
    state: currentSession?.state ?? 'offline',
    currentSession,
    activeSessionCount,
    weeklySessionCount,
    sessionTokens,
    weeklyTokens,
    processCount: 0,
    lastActivityMs: latestMtime,
    sources: ['gemini-chats'],
  };
}

interface DirProbeSpec {
  agentId: AgentId;
  displayName: string;
  dirs: string[];
  activityFiles?: string[];
}

const SIMPLE_AGENT_PROBES: DirProbeSpec[] = [
  {
    agentId: 'windsurf',
    displayName: 'Windsurf',
    dirs: [homePath('.codeium', 'windsurf'), homePath('Library', 'Application Support', 'Windsurf')],
  },
  {
    agentId: 'goose',
    displayName: 'Goose',
    dirs: [homePath('.local', 'share', 'goose'), homePath('.config', 'goose')],
    activityFiles: [homePath('.local', 'share', 'goose', 'sessions')],
  },
  {
    agentId: 'amp',
    displayName: 'Amp',
    dirs: [homePath('.local', 'share', 'amp'), homePath('.amp'), homePath('.config', 'amp')],
  },
  {
    agentId: 'droid',
    displayName: 'Factory Droid',
    dirs: [homePath('.factory')],
  },
  {
    agentId: 'kiro',
    displayName: 'Kiro',
    dirs: [homePath('.kiro')],
  },
  {
    agentId: 'junie',
    displayName: 'Junie',
    dirs: [homePath('.junie')],
    activityFiles: [homePath('.junie', 'history.jsonl'), homePath('.junie', 'logs')],
  },
  {
    agentId: 'pi',
    displayName: 'Pi Agent',
    dirs: [homePath('.pi')],
    activityFiles: [homePath('.pi', 'agent')],
  },
  {
    agentId: 'zed',
    displayName: 'Zed AI',
    dirs: [
      homePath('Library', 'Application Support', 'Zed'),
      homePath('.local', 'share', 'zed'),
    ],
  },
  {
    agentId: 'qwen',
    displayName: 'Qwen Code',
    dirs: [homePath('.qwen')],
  },
  {
    agentId: 'aider',
    displayName: 'Aider',
    dirs: [homePath('.aider')],
  },
];

function newestMtimeInPath(target: string, maxDepth = 2): number {
  const stat = safeStat(target);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  if (maxDepth <= 0) return newest;
  for (const entry of safeReadDir(target).slice(0, 60)) {
    const childPath = path.join(target, entry.name);
    const childStat = safeStat(childPath);
    if (!childStat) continue;
    if (childStat.mtimeMs > newest) newest = childStat.mtimeMs;
    if (childStat.isDirectory() && maxDepth > 1) {
      const sub = newestMtimeInPath(childPath, maxDepth - 1);
      if (sub > newest) newest = sub;
    }
  }
  return newest;
}

export function collectGenericFileAgents(activeWindowMs: number, nowMs = Date.now()): AgentSnapshot[] {
  const snapshots: AgentSnapshot[] = [];

  const gemini = collectGeminiCli(activeWindowMs, nowMs);
  if (gemini) snapshots.push(gemini);

  const cline = collectVscodeAgentExtension('cline', 'Cline', 'saoudrizwan.claude-dev', activeWindowMs, nowMs);
  if (cline) snapshots.push(cline);

  const roo = collectVscodeAgentExtension('roo', 'Roo Code', 'rooveterinaryinc.roo-cline', activeWindowMs, nowMs);
  if (roo) snapshots.push(roo);

  const kilo = collectVscodeAgentExtension('kilo', 'Kilo Code', 'kilocode.kilo-code', activeWindowMs, nowMs);
  if (kilo) snapshots.push(kilo);

  const activeCutoff = nowMs - activeWindowMs;
  const weekCutoff = nowMs - WEEK_MS;

  for (const spec of SIMPLE_AGENT_PROBES) {
    const existingDirs = spec.dirs.filter((d) => safeStat(d)?.isDirectory());
    if (existingDirs.length === 0) continue;

    let latestMtime = 0;
    const probePaths = spec.activityFiles?.length ? spec.activityFiles : existingDirs;
    for (const p of probePaths) {
      const m = newestMtimeInPath(p, 2);
      if (m > latestMtime) latestMtime = m;
    }

    const active = latestMtime >= activeCutoff;
    const weekly = latestMtime >= weekCutoff;
    const currentSession: SessionSnapshot | undefined = latestMtime
      ? {
          id: `${spec.agentId}-local`,
          agentId: spec.agentId,
          surface: 'local',
          state: active ? 'coding' : 'idle',
          startedAtMs: latestMtime,
          lastActivityMs: latestMtime,
        }
      : undefined;

    snapshots.push({
      agentId: spec.agentId,
      displayName: spec.displayName,
      installed: true,
      active,
      state: currentSession?.state ?? 'offline',
      currentSession,
      activeSessionCount: active ? 1 : 0,
      weeklySessionCount: weekly ? 1 : 0,
      sessionTokens: emptyTokens(),
      weeklyTokens: emptyTokens(),
      processCount: 0,
      lastActivityMs: latestMtime,
      sources: ['fs-probe'],
    });
  }

  return snapshots;
}

/**
 * Matches running OS processes against all built-in + custom agent patterns.
 * Returns a map of AgentId -> matched process count.
 */
export function matchAgentProcesses(
  processes: RunningProcess[],
  customAgents: CustomAgentRule[] = [],
): Map<AgentId, number> {
  const counts = new Map<AgentId, number>();

  const matchers: Array<{ id: AgentId; regexes: RegExp[] }> =
    customAgents.length === 0 ? BUILTIN_PROCESS_MATCHERS : [...BUILTIN_PROCESS_MATCHERS];

  for (const custom of customAgents) {
    if (!custom.processPatterns?.length) continue;
    const regexes: RegExp[] = [];
    for (const pat of custom.processPatterns) {
      try {
        regexes.push(new RegExp(pat, 'i'));
      } catch {
        // Ignore invalid user regex
      }
    }
    if (regexes.length > 0) {
      matchers.push({ id: custom.id, regexes });
    }
  }

  for (const proc of processes) {
    const cmd = proc.command;
    // Skip our own agent-rpc daemon / helper commands and generic OS UI helpers
    if (cmd.includes('agent-rpc') || cmd.includes('CursorUIViewService')) continue;
    // Skip noisy Electron Helper / crashpad child processes so an open app counts cleanly
    if (cmd.includes('chrome_crashpad_handler') || cmd.includes('Helper (GPU)') || cmd.includes('Helper (Renderer)')) {
      continue;
    }

    for (const m of matchers) {
      if (m.regexes.some((rx) => rx.test(cmd))) {
        counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
      }
    }
  }

  return counts;
}

export function buildProcessOnlySnapshot(
  agentId: AgentId,
  processCount: number,
  customAgents: CustomAgentRule[],
  nowMs: number,
): AgentSnapshot {
  const meta = getAgentMetadata(agentId, customAgents);
  const tokens: TokenUsage = emptyTokens();
  return {
    agentId,
    displayName: meta.displayName,
    installed: true,
    active: true,
    state: 'coding',
    currentSession: {
      id: `${agentId}-process`,
      agentId,
      surface: 'process',
      state: 'coding',
      startedAtMs: nowMs,
      lastActivityMs: nowMs,
    },
    activeSessionCount: Math.max(1, processCount),
    weeklySessionCount: 1,
    sessionTokens: tokens,
    weeklyTokens: emptyTokens(),
    processCount,
    lastActivityMs: nowMs,
    sources: ['process'],
  };
}
