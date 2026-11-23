import fs from 'node:fs';
import path from 'node:path';
import { AgentCollectorHub } from './collectors/index.js';
import { getPidPath, loadConfig, mergeConfig, saveConfig } from './config.js';
import { DiscordPresenceManager } from './discord/manager.js';
import { buildPresence } from './format.js';
import { LocalApiServer } from './server/api.js';
import type {
  AgentId,
  AppConfig,
  DaemonRuntimeStatus,
  FleetSnapshot,
  LiveEventInput,
  RenderedPresence,
} from './types.js';

export interface DaemonOptions {
  config?: AppConfig;
  writePidFile?: boolean;
  onLog?: (msg: string) => void;
}

export class AgentRpcDaemon {
  private config: AppConfig;
  private readonly writePidFile: boolean;
  private readonly log: (msg: string) => void;
  readonly collector = new AgentCollectorHub();
  readonly discord = new DiscordPresenceManager();
  private apiServer: LocalApiServer | null = null;

  private running = false;
  private paused = false;
  private overrideAgentId: AgentId | null = null;
  private startedAtMs = 0;
  private cycleTick = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private cycleTimer: NodeJS.Timeout | null = null;
  private polling = false;

  private latestFleet: FleetSnapshot = {
    collectedAtMs: 0,
    agents: [],
    activeAgents: [],
    totalActiveSessions: 0,
    totalInstalledAgents: 0,
    totalWeeklyTokens: 0,
    totalWeeklyCostUsd: 0,
  };
  private currentPresence: RenderedPresence | null = null;

  constructor(options: DaemonOptions = {}) {
    this.config = options.config ?? loadConfig();
    this.writePidFile = options.writePidFile ?? true;
    this.log = options.onLog ?? ((m) => console.log(m));
  }

  getStatus(): DaemonRuntimeStatus {
    return {
      running: this.running,
      paused: this.paused,
      overrideAgentId: this.overrideAgentId,
      pid: process.pid,
      startedAtMs: this.startedAtMs,
      uptimeSec: this.startedAtMs ? Math.floor((Date.now() - this.startedAtMs) / 1000) : 0,
      discord: this.discord.getState(),
      fleet: this.latestFleet,
      currentPresence: this.currentPresence,
      dashboardUrl: this.apiServer ? this.apiServer.url : null,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAtMs = Date.now();

    if (this.writePidFile) {
      const pidPath = getPidPath();
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      fs.writeFileSync(pidPath, `${process.pid}\n`, 'utf8');
    }

    if (this.config.server.enabled) {
      this.apiServer = new LocalApiServer(this.config.server.host, this.config.server.port, {
        getStatus: () => this.getStatus(),
        getConfig: () => this.config,
        updateConfig: async (patch) => {
          this.config = mergeConfig({
            ...this.config,
            ...patch,
            clientIds: patch.clientIds !== undefined ? patch.clientIds : this.config.clientIds,
            images: { ...this.config.images, ...(patch.images ?? {}) },
            quotas: { ...this.config.quotas, ...(patch.quotas ?? {}) },
            server: { ...this.config.server, ...(patch.server ?? {}) },
          });
          saveConfig(this.config);
          this.restartTimers();
          await this.tickNow();
          return this.config;
        },
        ingestEvent: async (event: LiveEventInput) => {
          this.collector.liveEvents.record(event);
          await this.tickNow();
        },
        setPaused: async (paused: boolean) => {
          this.paused = paused;
          if (paused) {
            this.currentPresence = null;
            await this.discord.clear();
          } else {
            await this.tickNow();
          }
        },
        setOverrideAgent: async (agentId: string | null) => {
          this.overrideAgentId = agentId;
          await this.tickNow();
        },
      });
      try {
        await this.apiServer.start();
        this.log(`[agent-rpc] Dashboard & Event API listening on ${this.apiServer.url}`);
      } catch (err) {
        this.log(
          `[agent-rpc] Warning: could not bind local API (${err instanceof Error ? err.message : String(err)})`,
        );
        this.apiServer = null;
      }
    }

    await this.tickNow();
    this.restartTimers();
  }

  private restartTimers(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.cycleTimer) clearInterval(this.cycleTimer);

    this.pollTimer = setInterval(() => {
      void this.tickNow();
    }, this.config.pollIntervalSec * 1000);

    this.cycleTimer = setInterval(() => {
      this.cycleTick += 1;
      void this.applyCurrentPresence();
    }, this.config.cycleIntervalSec * 1000);
  }

  async tickNow(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;
    try {
      this.latestFleet = await this.collector.collect(this.config, Date.now());
      await this.applyCurrentPresence();
    } catch (err) {
      this.log(`[agent-rpc] Poll error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.polling = false;
    }
  }

  private async applyCurrentPresence(): Promise<void> {
    if (!this.running) return;
    if (this.paused) {
      this.currentPresence = null;
      await this.discord.applyPresence(null);
      return;
    }

    const rendered = buildPresence(this.latestFleet, this.config, {
      cycleTick: this.cycleTick,
      nowMs: Date.now(),
      overrideAgentId: this.overrideAgentId,
    });
    this.currentPresence = rendered;
    await this.discord.applyPresence(rendered);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }

    await this.discord.shutdown();
    if (this.apiServer) {
      await this.apiServer.stop();
      this.apiServer = null;
    }

    if (this.writePidFile) {
      const pidPath = getPidPath();
      try {
        if (fs.existsSync(pidPath)) {
          const content = fs.readFileSync(pidPath, 'utf8').trim();
          if (content === String(process.pid)) {
            fs.unlinkSync(pidPath);
          }
        }
      } catch {
        // Ignore cleanup failure
      }
    }
  }
}
