import { getAgentMetadata } from './registry.js';
import type {
  AgentActivityState,
  AgentSnapshot,
  AppConfig,
  DiscordActivityPayload,
  DisplayMode,
  FleetSnapshot,
  QuotaInfo,
  RenderedPresence,
} from './types.js';

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const CLAUDE_MODEL_RE = /^claude-(opus|sonnet|haiku)-(\d+)(?:[-.](\d+))?/i;
const MODEL_DATE_SUFFIX_RE = /-\d{8}$/;
const MODEL_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^gemini-4-neon(?:-(?:x?high|med|low))?$/i, 'Gemini 4 Neon'],
  [/^gemini-(\d+(?:\.\d+)?)-([a-z0-9-]+)$/i, 'Gemini $1 $2'],
  [/^gpt-(\d+(?:\.\d+)?)(.*)$/i, 'GPT-$1$2'],
  [/^o(\d+)(.*)$/i, 'o$1$2'],
  [/^deepseek-(.+)$/i, 'DeepSeek $1'],
  [/^mistral-(.+)$/i, 'Mistral $1'],
  [/^grok-(.+)$/i, 'Grok $1'],
];

export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(count));
}

export function formatCost(usd: number | undefined): string | null {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0.005) return null;
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 10) return `$${usd.toFixed(1)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatResetLabel(resetsAtMs?: number, fallbackWeekday?: number, nowMs = Date.now()): string {
  if (typeof resetsAtMs === 'number' && Number.isFinite(resetsAtMs) && resetsAtMs > nowMs) {
    const diffMs = resetsAtMs - nowMs;
    const diffHours = diffMs / 3_600_000;
    const date = new Date(resetsAtMs);
    if (diffHours <= 24) {
      const hrs = Math.max(1, Math.round(diffHours));
      return `resets ${hrs}h`;
    }
    if (diffHours <= 7 * 24) {
      return `resets ${WEEKDAYS_SHORT[date.getDay()]}`;
    }
    return `resets ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
  }
  if (typeof fallbackWeekday === 'number' && fallbackWeekday >= 0 && fallbackWeekday <= 6) {
    return `resets ${WEEKDAYS_SHORT[fallbackWeekday]}`;
  }
  return '';
}

export function formatElapsed(startedAtMs: number, nowMs = Date.now()): string {
  const totalSec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
}

export function shortenModelName(model: string | undefined): string {
  if (!model) return '';
  let clean = model.trim();
  // Strip provider prefix like "openai/gpt-5.4" or "anthropic/claude-opus-4-6"
  if (clean.includes('/')) {
    clean = clean.slice(clean.lastIndexOf('/') + 1);
  }
  // Remove synthetic/placeholder values
  if (!clean || clean === '<synthetic>' || clean === 'unknown') return '';
  // Strip trailing date suffixes like -20250514
  clean = clean.replace(MODEL_DATE_SUFFIX_RE, '');
  // Nicely title-case common model names
  const claudeMatch = clean.match(CLAUDE_MODEL_RE);
  if (claudeMatch) {
    const tier = claudeMatch[1]!.charAt(0).toUpperCase() + claudeMatch[1]!.slice(1).toLowerCase();
    const major = claudeMatch[2]!;
    const minor = claudeMatch[3] ? `.${claudeMatch[3]}` : '';
    clean = `Claude ${tier} ${major}${minor}`;
  } else {
    for (const [pattern, replacement] of MODEL_REPLACEMENTS) {
      if (pattern.test(clean)) {
        clean = clean.replace(pattern, replacement).replace(/\.$/, '');
        break;
      }
    }
  }
  return clean.length > 28 ? `${clean.slice(0, 27)}…` : clean;
}

export function formatActionVerb(state: AgentActivityState, toolName?: string): string {
  if (toolName) {
    const clean = toolName.replace(/^mcp_[^_]+_/, '').replace(/_/g, ' ');
    return `Running ${clean}`;
  }
  switch (state) {
    case 'thinking':
      return 'Thinking';
    case 'coding':
      return 'Writing code';
    case 'tool':
      return 'Executing tools';
    case 'waiting':
      return 'Awaiting input';
    case 'idle':
      return 'Standing by';
    default:
      return 'Offline';
  }
}

export function resolveEffectiveQuota(
  agent: AgentSnapshot,
  config: AppConfig,
  nowMs = Date.now(),
): QuotaInfo | undefined {
  const nativeQuota = agent.quota;
  const budget = config.quotas[agent.agentId];
  const meta = getAgentMetadata(agent.agentId, config.customAgents);

  const weekly = nativeQuota?.weekly ?? (
    budget?.weeklyTokens && budget.weeklyTokens > 0
      ? {
          usedPercent: Math.min(100, Math.round((agent.weeklyTokens.total / budget.weeklyTokens) * 100)),
          label: budget.windowLabel ?? 'weekly',
          resetsAtMs: nextWeekdayTimestamp(budget.resetWeekday ?? meta.defaultResetWeekday, nowMs),
          estimated: true,
        }
      : undefined
  );

  let session = nativeQuota?.session;
  if (!session && budget?.sessionTokens && budget.sessionTokens > 0) {
    session = {
      usedPercent: Math.min(100, Math.round((agent.sessionTokens.total / budget.sessionTokens) * 100)),
      label: 'session',
      estimated: true,
    };
  } else if (
    !session &&
    agent.currentSession?.contextWindow &&
    agent.currentSession.contextWindow > 0 &&
    agent.currentSession.contextUsedTokens &&
    agent.currentSession.contextUsedTokens > 0
  ) {
    session = {
      usedPercent: Math.min(
        100,
        Math.round((agent.currentSession.contextUsedTokens / agent.currentSession.contextWindow) * 100),
      ),
      label: 'context',
    };
  }

  if (!weekly && !session && !nativeQuota?.planType && !nativeQuota?.creditsBalance) {
    return undefined;
  }

  return {
    weekly,
    session,
    planType: nativeQuota?.planType,
    creditsBalance: nativeQuota?.creditsBalance,
  };
}

function nextWeekdayTimestamp(targetWeekday: number, nowMs: number): number {
  const now = new Date(nowMs);
  const diff = (targetWeekday - now.getDay() + 7) % 7 || 7;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, 0, 0, 0, 0);
  return next.getTime();
}

export function resolveClientIdForAgent(
  agentId: string,
  config: AppConfig,
): { clientId: string; dedicatedApp: boolean } {
  const perAgent = config.clientIds[agentId]?.trim();
  if (perAgent) {
    return { clientId: perAgent, dedicatedApp: true };
  }
  const custom = config.customAgents.find((c) => c.id === agentId)?.clientId?.trim();
  if (custom) {
    return { clientId: custom, dedicatedApp: true };
  }
  return { clientId: config.defaultClientId.trim(), dedicatedApp: false };
}

export function resolveLargeImage(agentId: string, config: AppConfig): string {
  const override = config.images[agentId]?.trim();
  if (override) return override;

  const custom = config.customAgents.find((c) => c.id === agentId)?.largeImage?.trim();
  if (custom) return custom;

  const meta = getAgentMetadata(agentId, config.customAgents);
  if (config.imageBaseUrl) {
    return `${config.imageBaseUrl}/${meta.mascotKey}.png`;
  }
  if (meta.officialImageUrl) {
    return meta.officialImageUrl;
  }
  return meta.assetKey;
}

export function pickCycleView(
  mode: DisplayMode,
  cycleTick: number,
  fleet: FleetSnapshot,
): Exclude<DisplayMode, 'cycle'> {
  if (mode !== 'cycle') return mode;
  // Cycle: usage (2 ticks) -> activity (1 tick) -> fleet (1 tick if multiple agents exist, else usage)
  const views: Array<Exclude<DisplayMode, 'cycle'>> =
    fleet.totalInstalledAgents > 1 || fleet.activeAgents.length > 1
      ? ['usage', 'usage', 'activity', 'fleet']
      : ['usage', 'usage', 'activity'];
  return views[Math.abs(cycleTick) % views.length] ?? 'usage';
}

function clampDiscordText(value: string, maxLen = 128): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed.padEnd(2, ' ');
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed;
}

export function buildPresence(
  fleet: FleetSnapshot,
  config: AppConfig,
  options: {
    cycleTick?: number;
    nowMs?: number;
    overrideAgentId?: string | null;
  } = {},
): RenderedPresence | null {
  const nowMs = options.nowMs ?? Date.now();
  let agent: AgentSnapshot | undefined;

  if (options.overrideAgentId) {
    agent = fleet.agents.find((a) => a.agentId === options.overrideAgentId);
  }
  if (!agent) {
    agent = fleet.primaryAgent;
  }
  if (!agent) return null;

  const meta = getAgentMetadata(agent.agentId, config.customAgents);
  const { clientId, dedicatedApp } = resolveClientIdForAgent(agent.agentId, config);
  const appTitle = meta.displayName;
  const view = pickCycleView(config.displayMode, options.cycleTick ?? 0, fleet);
  const quota = resolveEffectiveQuota(agent, config, nowMs);
  const modelShort = shortenModelName(agent.currentSession?.model);
  const project = config.privacyMode ? undefined : agent.currentSession?.project;

  let details = '';
  let state = '';

  if (view === 'usage') {
    if (quota?.weekly) {
      const lead = modelShort || 'Usage';
      details = `${lead} · ${Math.round(quota.weekly.usedPercent)}% ${quota.weekly.label}`;
    } else if (modelShort && agent.weeklyTokens.total > 0) {
      details = `${modelShort} · ${formatTokens(agent.weeklyTokens.total)} tok/wk`;
    } else if (agent.weeklyTokens.total > 0) {
      details = `Usage · ${formatTokens(agent.weeklyTokens.total)} tok/wk`;
    } else if (modelShort) {
      details = project ? `${modelShort} · ${project}` : modelShort;
    } else {
      details = formatActionVerb(agent.state, agent.currentSession?.toolName);
    }

    const stateParts: string[] = [];
    if (quota?.session) {
      stateParts.push(`${quota.session.label} ${Math.round(quota.session.usedPercent)}%`);
    } else if (agent.sessionTokens.total > 0) {
      stateParts.push(`session ${formatTokens(agent.sessionTokens.total)}`);
    } else {
      stateParts.push(formatActionVerb(agent.state, agent.currentSession?.toolName));
    }

    const resetStr = quota?.weekly
      ? formatResetLabel(quota.weekly.resetsAtMs, meta.defaultResetWeekday, nowMs)
      : '';
    const costStr = formatCost(agent.weeklyCostUsd ?? agent.sessionCostUsd);

    if (resetStr) {
      stateParts.push(resetStr);
    } else if (costStr) {
      stateParts.push(costStr);
    } else if (project && !details.includes(project)) {
      stateParts.push(project);
    } else if (agent.host && agent.host !== meta.displayName) {
      stateParts.push(`via ${agent.host}`);
    }

    state = stateParts.join(' · ');
  } else if (view === 'activity') {
    const verb = formatActionVerb(agent.state, agent.currentSession?.toolName);
    if (modelShort && project) {
      details = `${modelShort} · ${project}`;
    } else if (modelShort) {
      details = `${modelShort} · ${verb}`;
    } else if (project) {
      details = `Working on ${project}`;
    } else {
      details = verb;
    }

    const stateParts: string[] = [];
    if (agent.currentSession?.statusDetail) {
      stateParts.push(agent.currentSession.statusDetail);
    } else if (!details.includes(verb)) {
      stateParts.push(verb);
    }

    if (agent.sessionTokens.total > 0) {
      stateParts.push(`${formatTokens(agent.sessionTokens.total)} tok`);
    } else if (agent.host && agent.host !== meta.displayName) {
      stateParts.push(`via ${agent.host}`);
    }
    state = stateParts.join(' · ') || verb;
  } else {
    // 'fleet' view: cross-agent overview
    const totalTok = fleet.totalWeeklyTokens;
    const totalCost = formatCost(fleet.totalWeeklyCostUsd);
    if (totalTok > 0) {
      details = `All Agents · ${formatTokens(totalTok)} tok/wk${totalCost ? ` (${totalCost})` : ''}`;
    } else {
      details = `All Agents · ${fleet.activeAgents.length || 1} active`;
    }

    const names = (fleet.activeAgents.length > 0 ? fleet.activeAgents : [agent])
      .slice(0, 3)
      .map((a) => getAgentMetadata(a.agentId, config.customAgents).shortName);
    const extra = Math.max(0, fleet.activeAgents.length - names.length);
    state = names.join(' + ') + (extra > 0 ? ` +${extra}` : '');
  }

  // Party badge (renders as "(3 sur 3)" in French Discord, "(3 of 3)" in English Discord!)
  let party: DiscordActivityPayload['party'] | undefined;
  const activeSessions = Math.max(1, fleet.totalActiveSessions);
  const installedCount = Math.max(1, fleet.totalInstalledAgents);

  if (config.partyMode === 'sessions') {
    party = { id: 'agent-rpc-sessions', size: [activeSessions, activeSessions] };
  } else if (config.partyMode === 'fleet') {
    const activeAgentsCount = Math.max(1, fleet.activeAgents.length);
    party = {
      id: 'agent-rpc-fleet',
      size: [activeAgentsCount, Math.max(activeAgentsCount, installedCount)],
    };
  } else if (config.partyMode === 'multi-only' && activeSessions > 1) {
    party = { id: 'agent-rpc-sessions', size: [activeSessions, activeSessions] };
  }

  // Hover tooltips
  const largeTextParts = [meta.displayName];
  if (modelShort) largeTextParts.push(modelShort);
  if (agent.weeklyTokens.total > 0) largeTextParts.push(`${formatTokens(agent.weeklyTokens.total)} tok/wk`);
  if (quota?.planType) largeTextParts.push(quota.planType);

  const smallTextParts: string[] = [];
  if (agent.host && agent.host !== meta.displayName) smallTextParts.push(`via ${agent.host}`);
  if (fleet.activeAgents.length > 1) {
    smallTextParts.push(`${fleet.activeAgents.length} agents active`);
  } else if (fleet.totalInstalledAgents > 1) {
    smallTextParts.push(`${fleet.totalInstalledAgents} agents tracked`);
  }

  const assets: DiscordActivityPayload['assets'] = {
    large_image: resolveLargeImage(agent.agentId, config),
    large_text: clampDiscordText(largeTextParts.join(' · ')),
  };

  if (config.smallImage) {
    assets.small_image = config.smallImage;
    if (smallTextParts.length > 0) {
      assets.small_text = clampDiscordText(smallTextParts.join(' · '));
    }
  }

  const activity: DiscordActivityPayload = {
    type: config.activityType,
    name: clampDiscordText(meta.displayName),
    status_display_type: 0,
    details: clampDiscordText(details),
    state: clampDiscordText(state),
    assets,
  };

  if (config.showTimer) {
    const startMs = agent.currentSession?.startedAtMs ?? agent.lastActivityMs ?? nowMs;
    const ageMs = nowMs - startMs;
    // Show elapsed timer for active sessions or recent sessions (< 24h) to avoid 300h idle timers
    if (agent.active || (ageMs >= 0 && ageMs < 24 * 3_600_000)) {
      activity.timestamps = {
        start: Math.floor(Math.min(startMs, nowMs) / 1000),
      };
    }
  }

  if (party) {
    activity.party = party;
  }

  if (config.buttons.length > 0) {
    activity.buttons = config.buttons.slice(0, 2).map((b) => ({
      label: b.label.slice(0, 32),
      url: b.url,
    }));
  }

  return {
    clientId,
    dedicatedApp,
    appTitle,
    agentId: agent.agentId,
    view,
    activity,
  };
}
