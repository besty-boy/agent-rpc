import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, DiscordActivityType, DisplayMode, PartyMode } from './types.js';

export const DEFAULT_PORT = 47391;

export function getConfigDir(): string {
  if (process.env.AGENT_RPC_CONFIG_DIR) {
    return path.resolve(process.env.AGENT_RPC_CONFIG_DIR);
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return path.join(xdg, 'agent-rpc');
  }
  return path.join(os.homedir(), '.config', 'agent-rpc');
}

export function getConfigPath(): string {
  if (process.env.AGENT_RPC_CONFIG) {
    return path.resolve(process.env.AGENT_RPC_CONFIG);
  }
  return path.join(getConfigDir(), 'config.json');
}

export function getPidPath(): string {
  return path.join(getConfigDir(), 'daemon.pid');
}

export function getLogPath(): string {
  return path.join(getConfigDir(), 'daemon.log');
}

export const DEFAULT_CONFIG: AppConfig = {
  defaultClientId: '',
  clientIds: {},
  displayMode: 'cycle',
  activityType: 0,
  cycleIntervalSec: 15,
  pollIntervalSec: 4,
  activeWindowMin: 10,
  idleGraceMin: 0,
  privacyMode: false,
  partyMode: 'sessions',
  showTimer: true,
  buttons: [
    {
      label: 'Get agent-rpc →',
      url: 'https://github.com/besty-boy/agent-rpc',
    },
  ],
  imageBaseUrl: '',
  images: {},
  smallImage: '',
  quotas: {},
  disabledAgents: [],
  customAgents: [],
  server: {
    enabled: true,
    host: '127.0.0.1',
    port: DEFAULT_PORT,
  },
  agentPriority: [
    'antigravity',
    'codex',
    'opencode',
    'claude',
    'vibe',
    'cursor',
    'copilot',
    'grok',
    'hermes',
    'gemini',
    'windsurf',
    'cline',
    'roo',
    'kilo',
    'aider',
    'goose',
    'amp',
    'droid',
    'kiro',
    'junie',
    'pi',
    'zed',
    'qwen',
    't3',
  ],
};

const VALID_DISPLAY_MODES = new Set<DisplayMode>(['cycle', 'usage', 'activity', 'fleet']);
const VALID_PARTY_MODES = new Set<PartyMode>(['sessions', 'fleet', 'multi-only', 'off']);
const VALID_ACTIVITY_TYPES = new Set<DiscordActivityType>([0, 2, 3, 5]);

export function mergeConfig(partial: Partial<AppConfig> | undefined): AppConfig {
  const src = partial ?? {};
  const displayMode: DisplayMode = VALID_DISPLAY_MODES.has(src.displayMode as DisplayMode)
    ? (src.displayMode as DisplayMode)
    : DEFAULT_CONFIG.displayMode;
  const partyMode: PartyMode = VALID_PARTY_MODES.has(src.partyMode as PartyMode)
    ? (src.partyMode as PartyMode)
    : DEFAULT_CONFIG.partyMode;
  const activityType: DiscordActivityType = VALID_ACTIVITY_TYPES.has(
    src.activityType as DiscordActivityType,
  )
    ? (src.activityType as DiscordActivityType)
    : DEFAULT_CONFIG.activityType;

  const buttons = Array.isArray(src.buttons)
    ? src.buttons
        .filter((b) => b && typeof b.label === 'string' && typeof b.url === 'string' && b.label.trim() && b.url.trim())
        .slice(0, 2)
    : DEFAULT_CONFIG.buttons;

  const merged: AppConfig = {
    defaultClientId:
      typeof src.defaultClientId === 'string' ? src.defaultClientId.trim() : DEFAULT_CONFIG.defaultClientId,
    clientIds: {
      ...DEFAULT_CONFIG.clientIds,
      ...(src.clientIds && typeof src.clientIds === 'object' ? src.clientIds : {}),
    },
    displayMode,
    activityType,
    cycleIntervalSec: clampNumber(src.cycleIntervalSec, 5, 300, DEFAULT_CONFIG.cycleIntervalSec),
    pollIntervalSec: clampNumber(src.pollIntervalSec, 2, 120, DEFAULT_CONFIG.pollIntervalSec),
    activeWindowMin: clampNumber(src.activeWindowMin, 1, 240, DEFAULT_CONFIG.activeWindowMin),
    idleGraceMin: clampNumber(src.idleGraceMin, 0, 1440, DEFAULT_CONFIG.idleGraceMin),
    privacyMode: typeof src.privacyMode === 'boolean' ? src.privacyMode : DEFAULT_CONFIG.privacyMode,
    partyMode,
    showTimer: typeof src.showTimer === 'boolean' ? src.showTimer : DEFAULT_CONFIG.showTimer,
    buttons,
    imageBaseUrl:
      typeof src.imageBaseUrl === 'string' ? src.imageBaseUrl.trim().replace(/\/+$/, '') : DEFAULT_CONFIG.imageBaseUrl,
    images: {
      ...DEFAULT_CONFIG.images,
      ...(src.images && typeof src.images === 'object' ? src.images : {}),
    },
    smallImage: typeof src.smallImage === 'string' ? src.smallImage.trim() : DEFAULT_CONFIG.smallImage,
    quotas: {
      ...DEFAULT_CONFIG.quotas,
      ...(src.quotas && typeof src.quotas === 'object' ? src.quotas : {}),
    },
    disabledAgents: Array.isArray(src.disabledAgents)
      ? src.disabledAgents.filter((x): x is string => typeof x === 'string')
      : DEFAULT_CONFIG.disabledAgents,
    customAgents: Array.isArray(src.customAgents) ? src.customAgents : DEFAULT_CONFIG.customAgents,
    server: {
      enabled:
        typeof src.server?.enabled === 'boolean' ? src.server.enabled : DEFAULT_CONFIG.server.enabled,
      host:
        typeof src.server?.host === 'string' && src.server.host.trim()
          ? src.server.host.trim()
          : DEFAULT_CONFIG.server.host,
      port: clampNumber(src.server?.port, 1024, 65535, DEFAULT_CONFIG.server.port),
    },
    agentPriority: Array.isArray(src.agentPriority) && src.agentPriority.length > 0
      ? src.agentPriority
      : DEFAULT_CONFIG.agentPriority,
  };

  // Environment overrides
  if (process.env.AGENT_RPC_CLIENT_ID) {
    merged.defaultClientId = process.env.AGENT_RPC_CLIENT_ID.trim();
  }
  if (process.env.AGENT_RPC_PORT) {
    const p = Number(process.env.AGENT_RPC_PORT);
    if (Number.isInteger(p) && p >= 1024 && p <= 65535) {
      merged.server.port = p;
    }
  }
  if (process.env.AGENT_RPC_PRIVACY === '1' || process.env.AGENT_RPC_PRIVACY === 'true') {
    merged.privacyMode = true;
  }
  if (process.env.AGENT_RPC_IMAGE_BASE_URL) {
    merged.imageBaseUrl = process.env.AGENT_RPC_IMAGE_BASE_URL.trim().replace(/\/+$/, '');
  }

  return merged;
}

export function loadConfig(): AppConfig {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) {
    return mergeConfig(undefined);
  }
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return mergeConfig(parsed);
  } catch {
    return mergeConfig(undefined);
  }
}

export function saveConfig(config: AppConfig): string {
  const cfgPath = getConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  const normalized = mergeConfig(config);
  fs.writeFileSync(cfgPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return cfgPath;
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next = mergeConfig({
    ...current,
    ...patch,
    clientIds: { ...current.clientIds, ...(patch.clientIds ?? {}) },
    images: { ...current.images, ...(patch.images ?? {}) },
    quotas: { ...current.quotas, ...(patch.quotas ?? {}) },
    server: { ...current.server, ...(patch.server ?? {}) },
  });
  saveConfig(next);
  return next;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}
