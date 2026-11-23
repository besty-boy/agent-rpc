import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLogPath } from './config.js';

const MAC_LABEL = 'com.agent-rpc.daemon';

function resolveCliEntrypoint(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cli.js');
}

export function getServiceFilePath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'LaunchAgents', `${MAC_LABEL}.plist`);
  }
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'agent-rpc.service');
}

export function renderMacLaunchAgentPlist(): string {
  const cliPath = resolveCliEntrypoint();
  const logPath = getLogPath();
  const nodePath = process.execPath;
  const currentPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>--no-warnings</string>
    <string>${cliPath}</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${currentPath}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

export function renderLinuxSystemdUnit(): string {
  const cliPath = resolveCliEntrypoint();
  const nodePath = process.execPath;
  return `[Unit]
Description=agent-rpc Universal AI Agent Discord Rich Presence Daemon
After=graphical-session.target

[Service]
Type=simple
ExecStart=${nodePath} --no-warnings ${cliPath} start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export function installAutoStartService(): { path: string; loaded: boolean; message: string } {
  const servicePath = getServiceFilePath();
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  fs.mkdirSync(path.dirname(getLogPath()), { recursive: true });

  if (process.platform === 'darwin') {
    fs.writeFileSync(servicePath, renderMacLaunchAgentPlist(), 'utf8');
    try {
      execFileSync('launchctl', ['unload', servicePath], { stdio: 'ignore' });
    } catch {
      // Not previously loaded
    }
    try {
      execFileSync('launchctl', ['load', '-w', servicePath], { stdio: 'ignore' });
      return {
        path: servicePath,
        loaded: true,
        message: `Installed and loaded macOS LaunchAgent (${MAC_LABEL}). Logs: ${getLogPath()}`,
      };
    } catch (err) {
      return {
        path: servicePath,
        loaded: false,
        message: `Wrote LaunchAgent to ${servicePath}, but launchctl load failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (process.platform === 'linux') {
    fs.writeFileSync(servicePath, renderLinuxSystemdUnit(), 'utf8');
    try {
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
      execFileSync('systemctl', ['--user', 'enable', '--now', 'agent-rpc.service'], { stdio: 'ignore' });
      return {
        path: servicePath,
        loaded: true,
        message: `Installed and started systemd user unit (${servicePath}).`,
      };
    } catch {
      return {
        path: servicePath,
        loaded: false,
        message: `Wrote systemd unit to ${servicePath}. Run "systemctl --user enable --now agent-rpc.service".`,
      };
    }
  }

  return {
    path: servicePath,
    loaded: false,
    message: 'Auto-start service installer supports macOS LaunchAgent and Linux systemd. On Windows, add "agent-rpc start" to Task Scheduler.',
  };
}

export function uninstallAutoStartService(): { removed: boolean; message: string } {
  const servicePath = getServiceFilePath();
  if (!fs.existsSync(servicePath)) {
    return { removed: false, message: `No service file found at ${servicePath}.` };
  }

  if (process.platform === 'darwin') {
    try {
      execFileSync('launchctl', ['unload', '-w', servicePath], { stdio: 'ignore' });
    } catch {
      // Ignore
    }
  } else if (process.platform === 'linux') {
    try {
      execFileSync('systemctl', ['--user', 'disable', '--now', 'agent-rpc.service'], { stdio: 'ignore' });
    } catch {
      // Ignore
    }
  }

  fs.unlinkSync(servicePath);
  return { removed: true, message: `Removed auto-start service (${servicePath}).` };
}
