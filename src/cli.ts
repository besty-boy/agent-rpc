import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { syncOfficialIcons } from '../scripts/sync-icons.js';
import { AgentCollectorHub } from './collectors/index.js';
import {
  getConfigPath,
  getLogPath,
  getPidPath,
  loadConfig,
  mergeConfig,
  saveConfig,
} from './config.js';
import { AgentRpcDaemon } from './daemon.js';
import { discoverDiscordIpcPaths } from './discord/ipc.js';
import {
  buildPresence,
  formatCost,
  formatElapsed,
  formatTokens,
  shortenModelName,
} from './format.js';
import {
  buildClaudeHooksSnippet,
  buildCodexNotifySnippet,
  buildOpenCodePluginSnippet,
  buildUniversalCurlSnippet,
  installClaudeHooks,
} from './hooks.js';
import { installAutoStartService, uninstallAutoStartService } from './service.js';
import type {
  AgentActivityState,
  AppConfig,
  DaemonRuntimeStatus,
  DisplayMode,
  LiveEventInput,
  PartyMode,
  RenderedPresence,
} from './types.js';

function parseFlags(args: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq >= 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function activityHeaderLabel(type: number | undefined, appTitle: string): string {
  switch (type) {
    case 2:
      return `Écoute ${appTitle}`;
    case 3:
      return `Regarde ${appTitle}`;
    case 5:
      return `Participe à ${appTitle}`;
    default:
      return 'Joue à';
  }
}

function renderCardAscii(presence: RenderedPresence): string {
  const act = presence.activity;
  const party = act.party && (act.type ?? 0) === 0 ? ` (${act.party.size[0]} sur ${act.party.size[1]})` : '';
  const timerIcon = act.type === 3 ? '🖥' : act.type === 2 ? '🎵' : '🎮';
  const timer = act.timestamps?.start
    ? `  ${timerIcon} ${formatElapsed(act.timestamps.start * 1000)}`
    : '';
  const btn = act.buttons?.[0] ? `\n│   [ ${act.buttons[0].label} ]` : '';
  const header = activityHeaderLabel(act.type, act.name ?? presence.appTitle);
  const titleLine = (act.type ?? 0) === 0 ? `\n│   ${act.name ?? presence.appTitle}` : '';
  const lines = [
    '┌──────────────────────────────────────────────────────────────┐',
    `│ ${header.padEnd(43)} [${presence.view.toUpperCase()}]${titleLine}`,
    `│   ${act.details ?? ''}`,
    `│   ${party ? '👥 ' : ''}${act.state ?? ''}${party}${timer}${btn}`,
    `│   🖼  ${act.assets?.large_image ?? '—'}  (name="${act.name ?? presence.appTitle}")`,
    '└──────────────────────────────────────────────────────────────┘',
  ];
  return lines.join('\n');
}

function printHelp(): void {
  console.log(`agent-rpc — Universal Discord Rich Presence for ALL AI coding agents

Usage:
  agent-rpc start              Start daemon in foreground (Discord IPC + Live Dashboard)
  agent-rpc daemon             Start daemon detached in background
  agent-rpc stop               Stop background daemon
  agent-rpc scan [--json]      Scan all local AI agents & preview Discord Rich Presence card
  agent-rpc status             Show running daemon & Discord connection status
  agent-rpc setup              Interactive wizard to configure Discord Client ID(s) & options
  agent-rpc config [path|get|set <key> <val>]
                               View or update ~/.config/agent-rpc/config.json
  agent-rpc emit --agent <id> [--state coding|thinking|tool|waiting] [--model <m>] [--project <p>]
                               Push an instant live event to the running daemon
  agent-rpc hooks [show|install-claude]
                               Show or install optional real-time lifecycle hooks
  agent-rpc service [install|uninstall|status]
                               Install/remove macOS LaunchAgent or Linux systemd auto-start
  agent-rpc icons [dir]        Download/refresh official logos & mascots into assets/mascots
  agent-rpc --version          Print agent-rpc version
`);
}

async function cmdScan(flags: Record<string, string | boolean>): Promise<void> {
  const config = loadConfig();
  const hub = new AgentCollectorHub();
  const fleet = await hub.collect(config, Date.now());
  const modeOverride = typeof flags.mode === 'string' ? (flags.mode as DisplayMode) : undefined;
  const effectiveConfig: AppConfig = modeOverride ? { ...config, displayMode: modeOverride } : config;
  const presence = buildPresence(fleet, effectiveConfig, {
    overrideAgentId: typeof flags.agent === 'string' ? flags.agent : null,
  });

  if (flags.json) {
    console.log(JSON.stringify({ fleet, presence }, null, 2));
    return;
  }

  console.log(`\nDetected ${fleet.totalInstalledAgents} AI agent(s) on this machine (${fleet.activeAgents.length} active right now):\n`);
  for (const a of fleet.agents) {
    const statusDot = a.active ? '● ACTIVE' : '○ idle  ';
    const model = shortenModelName(a.currentSession?.model) || '—';
    const proj = a.currentSession?.project || '—';
    const weekly = a.quota?.weekly
      ? `${Math.round(a.quota.weekly.usedPercent)}% ${a.quota.weekly.label}`
      : a.weeklyTokens.total > 0
        ? `${formatTokens(a.weeklyTokens.total)} tok/wk`
        : '—';
    const cost = formatCost(a.weeklyCostUsd);
    const extra = cost ? ` (${cost})` : '';
    console.log(
      `  ${statusDot}  ${a.displayName.padEnd(15)}  model=${model.padEnd(18)}  proj=${proj.padEnd(16)}  usage=${weekly}${extra}  [${a.sources.join(',')}]`,
    );
  }

  const sockets = discoverDiscordIpcPaths();
  console.log(`\nDiscord IPC socket: ${sockets[0] ?? 'not detected'}`);
  console.log(`Config file:        ${getConfigPath()}`);
  console.log(`Client ID set:      ${config.defaultClientId || Object.keys(config.clientIds).length > 0 ? 'YES' : 'NO (run "agent-rpc setup")'}`);

  if (presence) {
    console.log('\nDiscord Rich Presence Card Preview:\n');
    console.log(renderCardAscii(presence));
  } else {
    console.log('\nNo active or recent agent within idleGraceMin.');
  }
}

async function cmdStart(): Promise<void> {
  const config = loadConfig();
  const daemon = new AgentRpcDaemon({ config });

  const shutdown = async (sig: string) => {
    console.log(`\n[agent-rpc] Received ${sig}, clearing Discord presence…`);
    await daemon.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await daemon.start();
  const st = daemon.getStatus();
  console.log(`[agent-rpc] Running (PID ${process.pid})`);
  if (st.dashboardUrl) {
    console.log(`[agent-rpc] Live Dashboard: ${st.dashboardUrl}`);
  }
  if (!config.defaultClientId && Object.keys(config.clientIds).length === 0) {
    console.log(
      '[agent-rpc] Note: No Discord Client ID configured yet. Run "agent-rpc setup" or set it in the Live Dashboard.',
    );
  } else if (st.discord.connected) {
    console.log(
      `[agent-rpc] Connected to Discord${st.discord.user?.username ? ` as @${st.discord.user.username}` : ''} (${st.discord.socketPath})`,
    );
  } else if (st.discord.lastError) {
    console.log(`[agent-rpc] Discord status: ${st.discord.lastError} (will auto-retry)`);
  }
  if (st.currentPresence) {
    console.log('\n' + renderCardAscii(st.currentPresence));
  }
}

async function cmdDaemon(): Promise<void> {
  const pidPath = getPidPath();
  if (fs.existsSync(pidPath)) {
    const existingPid = Number(fs.readFileSync(pidPath, 'utf8').trim());
    if (existingPid > 0) {
      try {
        process.kill(existingPid, 0);
        console.log(`agent-rpc daemon is already running (PID ${existingPid}).`);
        return;
      } catch {
        fs.unlinkSync(pidPath);
      }
    }
  }

  const logPath = getLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const outFd = fs.openSync(logPath, 'a');
  const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cli.js');

  const child = spawn(process.execPath, ['--no-warnings', cliPath, 'start'], {
    detached: true,
    stdio: ['ignore', outFd, outFd],
  });
  child.unref();
  fs.closeSync(outFd);

  const cfg = loadConfig();
  console.log(`Started agent-rpc daemon in background (PID ${child.pid}).`);
  console.log(`Dashboard: http://${cfg.server.host}:${cfg.server.port}`);
  console.log(`Logs:      ${logPath}`);
}

async function cmdStop(): Promise<void> {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) {
    console.log('agent-rpc daemon is not running (no PID file found).');
    return;
  }
  const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    fs.unlinkSync(pidPath);
    console.log('Cleaned up invalid PID file.');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped agent-rpc daemon (PID ${pid}).`);
  } catch {
    console.log(`Process ${pid} was not running; removed stale PID file.`);
    fs.unlinkSync(pidPath);
  }
}

async function cmdStatus(flags: Record<string, string | boolean>): Promise<void> {
  const cfg = loadConfig();
  const url = `http://${cfg.server.host}:${cfg.server.port}/v1/status`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const st = (await res.json()) as DaemonRuntimeStatus;
    if (flags.json) {
      console.log(JSON.stringify(st, null, 2));
      return;
    }
    console.log(`agent-rpc daemon: RUNNING (PID ${st.pid}, uptime ${st.uptimeSec}s, paused=${st.paused})`);
    console.log(
      `Discord IPC:      ${st.discord.connected ? `CONNECTED (${st.discord.user?.username ?? 'ok'})` : `DISCONNECTED (${st.discord.lastError ?? 'offline'})`}`,
    );
    console.log(`Dashboard:        ${st.dashboardUrl ?? 'disabled'}`);
    console.log(`Active Agents:    ${st.fleet.activeAgents.map((a) => a.displayName).join(', ') || 'none'}`);
    if (st.currentPresence) {
      console.log('\n' + renderCardAscii(st.currentPresence));
    }
  } catch {
    console.log('agent-rpc daemon: NOT RUNNING');
    console.log(`Run "agent-rpc start" or "agent-rpc daemon" to start it.`);
  }
}

async function cmdSetup(): Promise<void> {
  const current = loadConfig();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n=== agent-rpc Interactive Setup ===\n');
    console.log('1. Go to https://discord.com/developers/applications → New Application');
    console.log('2. Name it e.g. "Agent RPC" (or create separate apps named "Antigravity", "Codex", "OpenCode", "Claude Code")');
    console.log('3. Copy the Application ID (Client ID) from General Information');
    console.log('4. Optional: Upload mascot PNGs from assets/mascots/ under Rich Presence → Art Assets\n');

    const ask = async (prompt: string, fallback: string): Promise<string> => {
      const answer = (await rl.question(`${prompt}${fallback ? ` [${fallback}]` : ''}: `)).trim();
      return answer || fallback;
    };

    const defaultClientId = await ask('Default Discord Application Client ID', current.defaultClientId);
    const displayMode = (await ask(
      'Display mode (cycle / usage / activity / fleet)',
      current.displayMode,
    )) as DisplayMode;
    const partyMode = (await ask(
      'Party counter "(N sur N)" mode (sessions / fleet / multi-only / off)',
      current.partyMode,
    )) as PartyMode;
    const privacyRaw = await ask('Privacy mode — hide project names? (y/N)', current.privacyMode ? 'y' : 'n');
    const privacyMode = privacyRaw.toLowerCase().startsWith('y');
    const btnLabel = await ask('CTA Button label (leave "-" to disable)', current.buttons[0]?.label ?? 'Get agent-rpc →');
    const btnUrl =
      btnLabel === '-'
        ? ''
        : await ask('CTA Button URL', current.buttons[0]?.url ?? 'https://github.com/besty-boy/agent-rpc');
    const imageBaseUrl = await ask(
      'Optional public HTTPS mascot folder URL (blank = Discord Art Assets)',
      current.imageBaseUrl,
    );

    const perAgentAns = await ask(
      'Configure dedicated per-agent Client IDs for dynamic bold Discord titles? (y/N)',
      'n',
    );
    const clientIds: Record<string, string> = { ...current.clientIds };
    if (perAgentAns.toLowerCase().startsWith('y')) {
      for (const id of ['antigravity', 'codex', 'opencode', 'claude', 'cursor', 'vibe', 'copilot']) {
        const val = await ask(`  Client ID for "${id}" (blank to skip)`, clientIds[id] ?? '');
        if (val) clientIds[id] = val;
      }
    }

    const updated = mergeConfig({
      ...current,
      defaultClientId,
      clientIds,
      displayMode,
      partyMode,
      privacyMode,
      imageBaseUrl,
      buttons: btnLabel !== '-' && btnLabel && btnUrl ? [{ label: btnLabel, url: btnUrl }] : [],
    });

    const savedPath = saveConfig(updated);
    console.log(`\nSaved configuration to ${savedPath}`);
    console.log('Next steps:');
    console.log('  • Run "agent-rpc scan" to preview your live Discord card');
    console.log('  • Run "agent-rpc start" (or "agent-rpc daemon") to connect to Discord');
    console.log('  • Run "agent-rpc service install" to auto-start on login');
  } finally {
    rl.close();
  }
}

function setNestedValue(obj: Record<string, unknown>, dottedKey: string, rawVal: string): void {
  const parts = dottedKey.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  let parsed: unknown = rawVal;
  if (rawVal === 'true') parsed = true;
  else if (rawVal === 'false') parsed = false;
  else if (/^-?\d+(\.\d+)?$/.test(rawVal) && !dottedKey.toLowerCase().includes('clientid')) {
    parsed = Number(rawVal);
  } else if ((rawVal.startsWith('{') && rawVal.endsWith('}')) || (rawVal.startsWith('[') && rawVal.endsWith(']'))) {
    try {
      parsed = JSON.parse(rawVal);
    } catch {
      parsed = rawVal;
    }
  }
  cur[parts[parts.length - 1]!] = parsed;
}

async function cmdConfig(positionals: string[]): Promise<void> {
  const action = positionals[0] ?? 'get';
  if (action === 'path') {
    console.log(getConfigPath());
    return;
  }
  if (action === 'get') {
    console.log(JSON.stringify(loadConfig(), null, 2));
    return;
  }
  if (action === 'set') {
    const key = positionals[1];
    const value = positionals[2];
    if (!key || value === undefined) {
      console.error('Usage: agent-rpc config set <key> <value>');
      process.exit(1);
    }
    const cfg = loadConfig() as unknown as Record<string, unknown>;
    setNestedValue(cfg, key, value);
    const saved = saveConfig(mergeConfig(cfg as Partial<AppConfig>));
    console.log(`Updated ${key} in ${saved}`);
    return;
  }
  console.error(`Unknown config action: ${action}`);
  process.exit(1);
}

async function cmdEmit(flags: Record<string, string | boolean>): Promise<void> {
  const agent = typeof flags.agent === 'string' ? flags.agent : '';
  if (!agent) {
    console.error('Missing required --agent <name>');
    process.exit(1);
  }
  const cfg = loadConfig();
  const port = typeof flags.port === 'string' ? Number(flags.port) : cfg.server.port;
  const payload: LiveEventInput = {
    agent,
    sessionId: typeof flags.session === 'string' ? flags.session : undefined,
    state: typeof flags.state === 'string' ? (flags.state as AgentActivityState) : 'coding',
    model: typeof flags.model === 'string' ? flags.model : undefined,
    project: typeof flags.project === 'string' ? flags.project : undefined,
    cwd: typeof flags.cwd === 'string' ? flags.cwd : process.cwd(),
    toolName: typeof flags.tool === 'string' ? flags.tool : undefined,
    statusDetail: typeof flags.detail === 'string' ? flags.detail : undefined,
  };

  if (typeof flags.weeklyPct === 'string') {
    payload.quota = {
      weekly: { usedPercent: Number(flags.weeklyPct), label: 'weekly' },
      session:
        typeof flags.sessionPct === 'string'
          ? { usedPercent: Number(flags.sessionPct), label: 'session' }
          : undefined,
    };
  }

  try {
    const res = await fetch(`http://${cfg.server.host}:${port}/v1/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      process.exitCode = 1;
    }
  } catch {
    // Silent failure when daemon is stopped so agent hooks never slow down or break workflows
    if (flags.strict) process.exit(1);
  }
}

async function cmdHooks(positionals: string[]): Promise<void> {
  const action = positionals[0] ?? 'show';
  const cfg = loadConfig();
  if (action === 'install-claude') {
    const res = installClaudeHooks(cfg.server.port);
    console.log(`Installed Claude Code hooks into ${res.path}`);
    return;
  }
  console.log('=== Note ===');
  console.log('Passive detection ALREADY works with zero hooks for Antigravity, Codex, OpenCode,');
  console.log('Claude Code, T3 Code, Cursor, Mistral Vibe, Copilot, Grok, Hermes, Gemini CLI, etc.');
  console.log('Optional hooks below add instant sub-second tool/state updates:\n');
  console.log('--- Claude Code (~/.claude/settings.json) ---');
  console.log(JSON.stringify(buildClaudeHooksSnippet(cfg.server.port), null, 2));
  console.log('\n--- Codex (~/.codex/config.toml) ---');
  console.log(buildCodexNotifySnippet(cfg.server.port));
  console.log('\n--- OpenCode (~/.config/opencode/plugins/agent-rpc.ts) ---');
  console.log(buildOpenCodePluginSnippet(cfg.server.port));
  console.log('\n--- Universal HTTP Push (ANY agent / custom script) ---');
  console.log(buildUniversalCurlSnippet(cfg.server.port));
}

async function cmdService(positionals: string[]): Promise<void> {
  const action = positionals[0] ?? 'status';
  if (action === 'install') {
    const res = installAutoStartService();
    console.log(res.message);
    return;
  }
  if (action === 'uninstall') {
    const res = uninstallAutoStartService();
    console.log(res.message);
    return;
  }
  const { getServiceFilePath } = await import('./service.js');
  const p = getServiceFilePath();
  console.log(`Service file: ${p} (${fs.existsSync(p) ? 'INSTALLED' : 'not installed'})`);
}

export async function runCli(argv: string[]): Promise<void> {
  const { positionals, flags } = parseFlags(argv);
  const cmd = positionals[0] ?? 'help';
  const rest = positionals.slice(1);

  if (flags.version || cmd === '--version' || cmd === '-v') {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const pkg = fs.existsSync(pkgPath)
      ? (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string })
      : {};
    console.log(`agent-rpc v${pkg.version ?? '1.0.0'}`);
    return;
  }

  if (flags.help || cmd === 'help' || cmd === '-h') {
    printHelp();
    return;
  }

  switch (cmd) {
    case 'start':
      await cmdStart();
      break;
    case 'daemon':
      await cmdDaemon();
      break;
    case 'stop':
      await cmdStop();
      break;
    case 'scan':
    case 'preview':
      await cmdScan(flags);
      break;
    case 'status':
      await cmdStatus(flags);
      break;
    case 'setup':
      await cmdSetup();
      break;
    case 'config':
      await cmdConfig(rest);
      break;
    case 'emit':
      await cmdEmit(flags);
      break;
    case 'hooks':
      await cmdHooks(rest);
      break;
    case 'service':
      await cmdService(rest);
      break;
    case 'icons':
    case 'mascots': {
      const { downloaded, skipped } = await syncOfficialIcons(rest[0]);
      console.log(`Synced ${downloaded.length} official icon(s) (${skipped.length} skipped).`);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
