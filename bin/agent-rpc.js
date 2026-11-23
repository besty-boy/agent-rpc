#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Re-exec with --no-warnings so Node's built-in node:sqlite ExperimentalWarning stays quiet.
if (!process.env.AGENT_RPC_NO_REEXEC && !process.execArgv.includes('--no-warnings')) {
  const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/src/cli.js');
  const result = spawnSync(process.execPath, ['--no-warnings', cliPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, AGENT_RPC_NO_REEXEC: '1' },
  });
  process.exit(result.status ?? (result.signal ? 1 : 0));
} else {
  const { runCli } = await import('../dist/src/cli.js');
  await runCli(process.argv.slice(2));
}
