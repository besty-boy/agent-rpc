export type BuiltinAgentId =
  | 'antigravity'
  | 'codex'
  | 'opencode'
  | 'claude'
  | 't3'
  | 'cursor'
  | 'vibe'
  | 'copilot'
  | 'grok'
  | 'hermes'
  | 'gemini'
  | 'windsurf'
  | 'cline'
  | 'roo'
  | 'kilo'
  | 'aider'
  | 'goose'
  | 'amp'
  | 'droid'
  | 'kiro'
  | 'junie'
  | 'pi'
  | 'zed'
  | 'qwen'
  | 'generic';

export type AgentId = BuiltinAgentId | (string & {});

export type AgentActivityState =
  | 'thinking'
  | 'coding'
  | 'tool'
  | 'waiting'
  | 'idle'
  | 'offline';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  total: number;
}

export interface QuotaWindow {
  /** Percentage used (0..100). */
  usedPercent: number;
  /** Label such as "weekly", "monthly", "5h", "session". */
  label: string;
  /** Window duration in minutes if known (e.g. 300 for 5h, 10080 for 7d). */
  windowMinutes?: number;
  /** Unix timestamp in milliseconds when this window resets. */
  resetsAtMs?: number;
  /** True when estimated from configured local token budget instead of provider API. */
  estimated?: boolean;
}

export interface QuotaInfo {
  /** Primary long-horizon quota (e.g. weekly or monthly). */
  weekly?: QuotaWindow;
  /** Short-horizon quota (e.g. 5h session window or context window %). */
  session?: QuotaWindow;
  /** Provider plan name if detected (e.g. "pro", "max", "plus", "free"). */
  planType?: string;
  /** Remaining credit balance if reported (e.g. Codex credits). */
  creditsBalance?: string;
}

export interface SessionSnapshot {
  id: string;
  agentId: AgentId;
  /** Sub-surface e.g. "cli", "ide", "t3-acp", "desktop". */
  surface?: string;
  state: AgentActivityState;
  model?: string;
  project?: string;
  cwd?: string;
  branch?: string;
  toolName?: string;
  statusDetail?: string;
  startedAtMs: number;
  lastActivityMs: number;
  tokens?: TokenUsage;
  contextWindow?: number;
  contextUsedTokens?: number;
  costUsd?: number;
}

export interface AgentSnapshot {
  agentId: AgentId;
  displayName: string;
  /** Detected installed or historical data present on machine. */
  installed: boolean;
  /** Currently active within the active window or live process/hook. */
  active: boolean;
  state: AgentActivityState;
  /** Primary active/most-recent session. */
  currentSession?: SessionSnapshot;
  /** Number of currently active concurrent sessions (including subagents when known). */
  activeSessionCount: number;
  /** Number of sessions active in the last 7 days. */
  weeklySessionCount: number;
  /** Current session token usage. */
  sessionTokens: TokenUsage;
  /** Rolling 7-day token usage for this agent. */
  weeklyTokens: TokenUsage;
  /** Rolling 7-day cost in USD if tracked. */
  weeklyCostUsd?: number;
  /** Current session cost in USD if tracked. */
  sessionCostUsd?: number;
  /** Quota / rate-limit info (native or budget-estimated). */
  quota?: QuotaInfo;
  /** Running OS process count matched for this agent. */
  processCount: number;
  /** Latest activity timestamp in ms. */
  lastActivityMs: number;
  /** Source(s) that produced this snapshot (e.g. "transcript", "sqlite", "hook", "process"). */
  sources: string[];
  /** Host orchestrator if running inside T3 Code, VS Code, etc. */
  host?: string;
}

export interface FleetSnapshot {
  collectedAtMs: number;
  agents: AgentSnapshot[];
  activeAgents: AgentSnapshot[];
  /** Selected primary agent to showcase in Discord right now. */
  primaryAgent?: AgentSnapshot;
  /** Total concurrent active sessions across all agents. */
  totalActiveSessions: number;
  /** Total installed/detected agents on the machine. */
  totalInstalledAgents: number;
  /** Total rolling 7-day tokens across all agents. */
  totalWeeklyTokens: number;
  /** Total rolling 7-day USD cost across all agents. */
  totalWeeklyCostUsd: number;
}

export interface LiveEventInput {
  agent: AgentId;
  sessionId?: string;
  state?: AgentActivityState;
  model?: string;
  project?: string;
  cwd?: string;
  branch?: string;
  toolName?: string;
  statusDetail?: string;
  surface?: string;
  host?: string;
  startedAtMs?: number;
  tokens?: Partial<TokenUsage>;
  weeklyTokens?: number;
  costUsd?: number;
  weeklyCostUsd?: number;
  contextWindow?: number;
  contextUsedTokens?: number;
  quota?: QuotaInfo;
  /** Event TTL in ms before decaying to idle (default 90_000). */
  ttlMs?: number;
}

export type DisplayMode = 'cycle' | 'usage' | 'activity' | 'fleet';
export type PartyMode = 'sessions' | 'fleet' | 'multi-only' | 'off';
export type DiscordActivityType = 0 | 2 | 3 | 5;

export interface DiscordButtonConfig {
  label: string;
  url: string;
}

export interface AgentQuotaBudgetConfig {
  /** Weekly token budget used to compute "% weekly" when agent has no native rate-limit API. */
  weeklyTokens?: number;
  /** Session / 5h token budget used to compute "session X%". */
  sessionTokens?: number;
  /** Reset weekday (0 = Sun .. 6 = Sat). */
  resetWeekday?: number;
  /** Label override for weekly window (default "weekly"). */
  windowLabel?: string;
}

export interface CustomAgentRule {
  id: string;
  displayName: string;
  color?: string;
  processPatterns?: string[];
  clientId?: string;
  largeImage?: string;
}

export interface AppConfig {
  /** Fallback Discord Application Client ID (single-app mode or fallback for agents without their own ID). */
  defaultClientId: string;
  /** Optional per-agent Discord Application Client IDs so Discord's bold title switches dynamically! */
  clientIds: Record<string, string>;
  /** Display mode: 'cycle' rotates usage/activity/fleet, or lock to one mode. */
  displayMode: DisplayMode;
  /** Discord Activity type: 0 = Playing (Joue à), 2 = Listening (Écoute), 3 = Watching (Regarde), 5 = Competing (Participe à). */
  activityType: DiscordActivityType;
  /** Seconds between cycling views when displayMode === 'cycle'. */
  cycleIntervalSec: number;
  /** Seconds between local agent polls. */
  pollIntervalSec: number;
  /** Minutes before an inactive session stops showing as active in Discord. */
  activeWindowMin: number;
  /** Minutes to keep showing last recent agent when idle (0 = clear immediately when inactive). */
  idleGraceMin: number;
  /** Hide repository/project names on Discord for privacy. */
  privacyMode: boolean;
  /** How to populate Discord's party badge (e.g. "(3 sur 3)"). */
  partyMode: PartyMode;
  /** Show Discord elapsed timer. */
  showTimer: boolean;
  /** Up to 2 custom CTA buttons shown on the Discord card. */
  buttons: DiscordButtonConfig[];
  /**
   * Optional public HTTPS base URL hosting `<agentId>.png` mascot files
   * (e.g. "https://raw.githubusercontent.com/<you>/agent-rpc/main/assets/mascots").
   * When unset, Discord Developer Portal Art Asset keys (`agent_<id>`) are used.
   */
  imageBaseUrl: string;
  /** Per-agent large image override (Discord asset key or direct https:// URL). */
  images: Record<string, string>;
  /** Optional small corner badge override (asset key, https:// URL, or empty to omit). */
  smallImage?: string;
  /** Optional per-agent weekly/session token budgets for "% weekly" / "session X%" rendering. */
  quotas: Record<string, AgentQuotaBudgetConfig>;
  /** Disable specific agent collectors by ID. */
  disabledAgents: string[];
  /** Custom agent definitions for any tool not built-in. */
  customAgents: CustomAgentRule[];
  /** Local HTTP API + live web dashboard settings (loopback only). */
  server: {
    enabled: boolean;
    host: string;
    port: number;
  };
  /** Optional pinned/preferred agent order when multiple agents are simultaneously active. */
  agentPriority: string[];
}

export interface DiscordActivityPayload {
  type?: number;
  name?: string;
  status_display_type?: 0 | 1 | 2;
  details?: string;
  state?: string;
  timestamps?: {
    start?: number;
    end?: number;
  };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  party?: {
    id: string;
    size: [number, number];
  };
  buttons?: Array<{
    label: string;
    url: string;
  }>;
  instance?: boolean;
}

export interface RenderedPresence {
  /** Which Discord Client ID to connect with. */
  clientId: string;
  /** True when the chosen Client ID is dedicated to this specific agent (so Discord title IS the agent name). */
  dedicatedApp: boolean;
  /** Expected Discord bold title (agent name in dedicated mode, or "Agent RPC" in single-app mode). */
  appTitle: string;
  agentId: AgentId;
  view: Exclude<DisplayMode, 'cycle'>;
  activity: DiscordActivityPayload;
}

export interface DiscordConnectionState {
  connected: boolean;
  clientId: string | null;
  socketPath: string | null;
  user?: {
    id: string;
    username: string;
    global_name?: string | null;
  };
  lastUpdateAtMs?: number;
  lastError?: string;
}

export interface DaemonRuntimeStatus {
  running: boolean;
  paused: boolean;
  overrideAgentId: AgentId | null;
  pid: number;
  startedAtMs: number;
  uptimeSec: number;
  discord: DiscordConnectionState;
  fleet: FleetSnapshot;
  currentPresence: RenderedPresence | null;
  dashboardUrl: string | null;
}
