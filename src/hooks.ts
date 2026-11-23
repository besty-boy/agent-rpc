import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PORT } from './config.js';

export function buildClaudeHooksSnippet(port = DEFAULT_PORT): Record<string, unknown> {
  const emitCmd = (state: string) =>
    `agent-rpc emit --agent claude --state ${state} --cwd "$PWD" --port ${port} >/dev/null 2>&1 &`;

  return {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: emitCmd('thinking') }] }],
      PreToolUse: [{ hooks: [{ type: 'command', command: emitCmd('tool') }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: emitCmd('coding') }] }],
      Stop: [{ hooks: [{ type: 'command', command: emitCmd('waiting') }] }],
    },
  };
}

export function buildCodexNotifySnippet(port = DEFAULT_PORT): string {
  return `# Add to ~/.codex/config.toml
notify = ["agent-rpc", "emit", "--agent", "codex", "--state", "coding", "--port", "${port}"]`;
}

export function buildOpenCodePluginSnippet(port = DEFAULT_PORT): string {
  return `// Save to ~/.config/opencode/plugins/agent-rpc.ts
export default async function agentRpcPlugin({ directory }: { directory: string }) {
  const send = (state: string, toolName?: string) => {
    fetch("http://127.0.0.1:${port}/v1/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "opencode", state, cwd: directory, toolName }),
    }).catch(() => {});
  };
  return {
    "tool.execute.before": async (input: { tool?: string }) => send("tool", input?.tool),
    "tool.execute.after": async () => send("coding"),
    "session.idle": async () => send("waiting"),
  };
}`;
}

export function buildUniversalCurlSnippet(port = DEFAULT_PORT): string {
  return `# Push from ANY custom AI agent, MCP server, or wrapper script:
curl -sS -X POST http://127.0.0.1:${port}/v1/event \\
  -H 'Content-Type: application/json' \\
  -d '{"agent":"antigravity","state":"coding","model":"gemini-4-neon","project":"my-app"}'`;
}

export function installClaudeHooks(port = DEFAULT_PORT): { path: string; installed: boolean } {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  let current: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      current = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }

  const snippet = buildClaudeHooksSnippet(port);
  const existingHooks = (current.hooks && typeof current.hooks === 'object'
    ? current.hooks
    : {}) as Record<string, unknown[]>;
  const incomingHooks = snippet.hooks as Record<string, unknown[]>;

  for (const [eventName, entries] of Object.entries(incomingHooks)) {
    const prev = Array.isArray(existingHooks[eventName]) ? existingHooks[eventName]! : [];
    const alreadyPresent = prev.some((item) => JSON.stringify(item).includes('agent-rpc emit'));
    if (!alreadyPresent) {
      existingHooks[eventName] = [...prev, ...entries];
    }
  }

  current.hooks = existingHooks;
  fs.writeFileSync(settingsPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return { path: settingsPath, installed: true };
}
