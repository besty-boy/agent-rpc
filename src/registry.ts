import type { AgentId, BuiltinAgentId, CustomAgentRule } from './types.js';

const LOBE_DARK = 'https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-png/dark';

export interface AgentMetadata {
  id: AgentId;
  displayName: string;
  shortName: string;
  vendor: string;
  color: string;
  accentColor: string;
  mascotKey: string;
  assetKey: string;
  /** Official public HTTPS logo/mascot PNG URL (proxied natively by Discord Rich Presence). */
  officialImageUrl?: string;
  /** Regex strings matched against OS process command lines as passive fallback. */
  processPatterns: string[];
  /** Typical default reset weekday (1 = Monday, 3 = Wednesday). */
  defaultResetWeekday: number;
}

export const BUILTIN_AGENTS: Record<BuiltinAgentId, AgentMetadata> = {
  antigravity: {
    id: 'antigravity',
    displayName: 'Antigravity',
    shortName: 'Antigravity',
    vendor: 'Google DeepMind',
    color: '#6366f1',
    accentColor: '#38bdf8',
    mascotKey: 'antigravity',
    assetKey: 'antigravity',
    officialImageUrl: `${LOBE_DARK}/antigravity-color.png`,
    processPatterns: [
      'Antigravity\\.app',
      'Antigravity IDE\\.app',
      'antigravity-acp',
      '(^|/)antigravity(\\s|$)',
      '(^|/)agy(\\s|$)',
    ],
    defaultResetWeekday: 1,
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    shortName: 'Codex',
    vendor: 'OpenAI',
    color: '#10b981',
    accentColor: '#6ee7b7',
    mascotKey: 'codex',
    assetKey: 'codex',
    officialImageUrl: `${LOBE_DARK}/codex-color.png`,
    processPatterns: ['(^|/)codex(\\s|$)', 'Codex\\.app', '@openai/codex'],
    defaultResetWeekday: 1,
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    shortName: 'OpenCode',
    vendor: 'Anomaly / SST',
    color: '#06b6d4',
    accentColor: '#67e8f9',
    mascotKey: 'opencode',
    assetKey: 'opencode',
    officialImageUrl: `${LOBE_DARK}/opencode.png`,
    processPatterns: ['OpenCode\\.app', '(^|/)opencode2?(\\s|$)', 'opencode-t3'],
    defaultResetWeekday: 1,
  },
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    shortName: 'Claude',
    vendor: 'Anthropic',
    color: '#d97757',
    accentColor: '#fbbf24',
    mascotKey: 'claude',
    assetKey: 'claude',
    officialImageUrl: `${LOBE_DARK}/claudecode-color.png`,
    processPatterns: ['(^|/)claude(\\s|$)', 'claude-code', '@anthropic-ai/claude-code'],
    defaultResetWeekday: 3,
  },
  t3: {
    id: 't3',
    displayName: 'T3 Code',
    shortName: 'T3 Code',
    vendor: 'T3',
    color: '#8b5cf6',
    accentColor: '#c4b5fd',
    mascotKey: 't3',
    assetKey: 't3',
    officialImageUrl: 'https://t3.codes/apple-touch-icon.png',
    processPatterns: ['T3 Code.*\\.app', '(^|/)t3(\\s|$)'],
    defaultResetWeekday: 1,
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor',
    shortName: 'Cursor',
    vendor: 'Anysphere',
    color: '#3b82f6',
    accentColor: '#93c5fd',
    mascotKey: 'cursor',
    assetKey: 'cursor',
    officialImageUrl: `${LOBE_DARK}/cursor.png`,
    processPatterns: ['Cursor\\.app/Contents/MacOS/Cursor', '(^|/)cursor-agent(\\s|$)'],
    defaultResetWeekday: 1,
  },
  vibe: {
    id: 'vibe',
    displayName: 'Mistral Vibe',
    shortName: 'Vibe',
    vendor: 'Mistral AI',
    color: '#f97316',
    accentColor: '#fde047',
    mascotKey: 'vibe',
    assetKey: 'vibe',
    officialImageUrl: `${LOBE_DARK}/mistral-color.png`,
    processPatterns: ['mistral-vibe', '(^|/)vibe(\\s|$)'],
    defaultResetWeekday: 1,
  },
  copilot: {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    shortName: 'Copilot',
    vendor: 'GitHub',
    color: '#0ea5e9',
    accentColor: '#7dd3fc',
    mascotKey: 'copilot',
    assetKey: 'copilot',
    officialImageUrl: `${LOBE_DARK}/githubcopilot.png`,
    processPatterns: ['copilot-language-server', '(^|/)copilot(\\s|$)', 'gh-copilot'],
    defaultResetWeekday: 1,
  },
  grok: {
    id: 'grok',
    displayName: 'Grok CLI',
    shortName: 'Grok',
    vendor: 'xAI',
    color: '#e5e7eb',
    accentColor: '#9ca3af',
    mascotKey: 'grok',
    assetKey: 'grok',
    officialImageUrl: `${LOBE_DARK}/grok.png`,
    processPatterns: ['\\.grok/bin/', '(^|/)grok(\\s|$)'],
    defaultResetWeekday: 1,
  },
  hermes: {
    id: 'hermes',
    displayName: 'Hermes Agent',
    shortName: 'Hermes',
    vendor: 'Nous / Hermes',
    color: '#14b8a6',
    accentColor: '#fbbf24',
    mascotKey: 'hermes',
    assetKey: 'hermes',
    officialImageUrl: `${LOBE_DARK}/hermesagent.png`,
    processPatterns: ['(^|/)hermes(-agent|-acp)?(\\s|$)'],
    defaultResetWeekday: 1,
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini CLI',
    shortName: 'Gemini',
    vendor: 'Google',
    color: '#4285f4',
    accentColor: '#a855f7',
    mascotKey: 'gemini',
    assetKey: 'gemini',
    officialImageUrl: `${LOBE_DARK}/geminicli-color.png`,
    processPatterns: ['(^|/)gemini(\\s|$)', '@google/gemini-cli'],
    defaultResetWeekday: 1,
  },
  windsurf: {
    id: 'windsurf',
    displayName: 'Windsurf',
    shortName: 'Windsurf',
    vendor: 'Codeium',
    color: '#06d6a0',
    accentColor: '#67e8f9',
    mascotKey: 'windsurf',
    assetKey: 'windsurf',
    officialImageUrl: `${LOBE_DARK}/windsurf.png`,
    processPatterns: ['Windsurf\\.app', 'language_server_macos.*windsurf'],
    defaultResetWeekday: 1,
  },
  cline: {
    id: 'cline',
    displayName: 'Cline',
    shortName: 'Cline',
    vendor: 'Cline',
    color: '#22c55e',
    accentColor: '#86efac',
    mascotKey: 'cline',
    assetKey: 'cline',
    officialImageUrl: `${LOBE_DARK}/cline.png`,
    processPatterns: ['saoudrizwan\\.claude-dev', '(^|/)cline(\\s|$)'],
    defaultResetWeekday: 1,
  },
  roo: {
    id: 'roo',
    displayName: 'Roo Code',
    shortName: 'Roo',
    vendor: 'Roo Code',
    color: '#a855f7',
    accentColor: '#f0abfc',
    mascotKey: 'roo',
    assetKey: 'roo',
    officialImageUrl: `${LOBE_DARK}/roocode.png`,
    processPatterns: ['rooveterinaryinc\\.roo-cline'],
    defaultResetWeekday: 1,
  },
  kilo: {
    id: 'kilo',
    displayName: 'Kilo Code',
    shortName: 'Kilo',
    vendor: 'Kilo Code',
    color: '#eab308',
    accentColor: '#fef08a',
    mascotKey: 'kilo',
    assetKey: 'kilo',
    officialImageUrl: `${LOBE_DARK}/kilocode.png`,
    processPatterns: ['kilocode\\.kilo-code', '(^|/)kilocode(\\s|$)'],
    defaultResetWeekday: 1,
  },
  aider: {
    id: 'aider',
    displayName: 'Aider',
    shortName: 'Aider',
    vendor: 'Aider',
    color: '#84cc16',
    accentColor: '#bef264',
    mascotKey: 'aider',
    assetKey: 'aider',
    officialImageUrl: 'https://github.com/Aider-AI.png?size=512',
    processPatterns: ['(^|/)aider(\\s|$)', 'python.*-m\\s+aider'],
    defaultResetWeekday: 1,
  },
  goose: {
    id: 'goose',
    displayName: 'Goose',
    shortName: 'Goose',
    vendor: 'Block',
    color: '#f59e0b',
    accentColor: '#fef3c7',
    mascotKey: 'goose',
    assetKey: 'goose',
    officialImageUrl: `${LOBE_DARK}/goose.png`,
    processPatterns: ['(^|/)goose(\\s|$)', 'Goose\\.app'],
    defaultResetWeekday: 1,
  },
  amp: {
    id: 'amp',
    displayName: 'Amp',
    shortName: 'Amp',
    vendor: 'Sourcegraph',
    color: '#ef4444',
    accentColor: '#fca5a5',
    mascotKey: 'amp',
    assetKey: 'amp',
    officialImageUrl: `${LOBE_DARK}/amp-color.png`,
    processPatterns: ['(^|/)amp(\\s|$)', '@sourcegraph/amp'],
    defaultResetWeekday: 1,
  },
  droid: {
    id: 'droid',
    displayName: 'Factory Droid',
    shortName: 'Droid',
    vendor: 'Factory',
    color: '#fb923c',
    accentColor: '#fed7aa',
    mascotKey: 'droid',
    assetKey: 'droid',
    officialImageUrl: 'https://github.com/Factory-AI.png?size=512',
    processPatterns: ['(^|/)droid(\\s|$)', '\\.factory/'],
    defaultResetWeekday: 1,
  },
  kiro: {
    id: 'kiro',
    displayName: 'Kiro',
    shortName: 'Kiro',
    vendor: 'AWS',
    color: '#9333ea',
    accentColor: '#d8b4fe',
    mascotKey: 'kiro',
    assetKey: 'kiro',
    officialImageUrl: `${LOBE_DARK}/kiro-color.png`,
    processPatterns: ['Kiro\\.app', '(^|/)kiro-cli(\\s|$)', '(^|/)kiro(\\s|$)'],
    defaultResetWeekday: 1,
  },
  junie: {
    id: 'junie',
    displayName: 'Junie',
    shortName: 'Junie',
    vendor: 'JetBrains',
    color: '#22c55e',
    accentColor: '#facc15',
    mascotKey: 'junie',
    assetKey: 'junie',
    officialImageUrl: `${LOBE_DARK}/junie-color.png`,
    processPatterns: ['(^|/)junie(\\s|$)', 'matterhorn.*junie'],
    defaultResetWeekday: 1,
  },
  pi: {
    id: 'pi',
    displayName: 'Pi Agent',
    shortName: 'Pi',
    vendor: 'Pi',
    color: '#ec4899',
    accentColor: '#f9a8d4',
    mascotKey: 'pi',
    assetKey: 'pi',
    officialImageUrl: `${LOBE_DARK}/pi.png`,
    processPatterns: ['(^|/)pi(\\s|$)', 'pi-coding-agent'],
    defaultResetWeekday: 1,
  },
  zed: {
    id: 'zed',
    displayName: 'Zed AI',
    shortName: 'Zed',
    vendor: 'Zed Industries',
    color: '#2563eb',
    accentColor: '#60a5fa',
    mascotKey: 'zed',
    assetKey: 'zed',
    officialImageUrl: 'https://github.com/zed-industries.png?size=512',
    processPatterns: ['Zed\\.app/Contents/MacOS/zed'],
    defaultResetWeekday: 1,
  },
  qwen: {
    id: 'qwen',
    displayName: 'Qwen Code',
    shortName: 'Qwen',
    vendor: 'Alibaba',
    color: '#7c3aed',
    accentColor: '#a78bfa',
    mascotKey: 'qwen',
    assetKey: 'qwen',
    officialImageUrl: `${LOBE_DARK}/qwen-color.png`,
    processPatterns: ['(^|/)qwen(\\s|$)', '@qwen-code/qwen-code'],
    defaultResetWeekday: 1,
  },
  generic: {
    id: 'generic',
    displayName: 'AI Agent',
    shortName: 'Agent',
    vendor: 'Custom',
    color: '#8b5cf6',
    accentColor: '#38bdf8',
    mascotKey: 'generic',
    assetKey: 'generic',
    processPatterns: [],
    defaultResetWeekday: 1,
  },
};

export const BUILTIN_AGENT_IDS = Object.keys(BUILTIN_AGENTS) as BuiltinAgentId[];

/** Map provider/driver aliases (e.g. from T3 Code or hooks) to canonical AgentId. */
export function normalizeAgentId(raw: string): AgentId {
  const lower = raw.trim().toLowerCase();
  if (!lower) return 'generic';
  if (lower in BUILTIN_AGENTS) return lower as BuiltinAgentId;
  if (lower.includes('antigravity') || lower === 'agy') return 'antigravity';
  if (lower.includes('codex') || lower === 'openai-codex') return 'codex';
  if (lower.includes('opencode')) return 'opencode';
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('mistral') || lower.includes('vibe')) return 'vibe';
  if (lower.includes('copilot')) return 'copilot';
  if (lower.includes('cursor')) return 'cursor';
  if (lower.includes('grok')) return 'grok';
  if (lower.includes('hermes')) return 'hermes';
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('windsurf') || lower.includes('cascade')) return 'windsurf';
  if (lower.includes('roo')) return 'roo';
  if (lower.includes('kilo')) return 'kilo';
  if (lower.includes('cline')) return 'cline';
  if (lower.includes('aider')) return 'aider';
  if (lower.includes('goose')) return 'goose';
  if (lower.includes('droid') || lower.includes('factory')) return 'droid';
  if (lower.includes('kiro')) return 'kiro';
  if (lower.includes('junie')) return 'junie';
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('zed')) return 'zed';
  if (lower === 't3' || lower.includes('t3-code') || lower.includes('t3code')) return 't3';
  if (lower === 'pi' || lower.includes('pi-agent')) return 'pi';
  if (lower === 'amp') return 'amp';
  return lower;
}

export function getAgentMetadata(
  id: AgentId,
  customAgents: CustomAgentRule[] = [],
): AgentMetadata {
  const normalized = normalizeAgentId(id);
  const builtin = BUILTIN_AGENTS[normalized as BuiltinAgentId];
  if (builtin) return builtin;

  const custom = customAgents.find((c) => c.id.toLowerCase() === id.toLowerCase());
  if (custom) {
    return {
      id: custom.id,
      displayName: custom.displayName,
      shortName: custom.displayName,
      vendor: 'Custom',
      color: custom.color ?? '#8b5cf6',
      accentColor: '#38bdf8',
      mascotKey: 'generic',
      assetKey: custom.largeImage ?? 'generic',
      processPatterns: custom.processPatterns ?? [],
      defaultResetWeekday: 1,
    };
  }

  const label = id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    id,
    displayName: label || 'AI Agent',
    shortName: label || 'Agent',
    vendor: 'Custom',
    color: '#8b5cf6',
    accentColor: '#38bdf8',
    mascotKey: 'generic',
    assetKey: 'generic',
    processPatterns: [],
    defaultResetWeekday: 1,
  };
}
