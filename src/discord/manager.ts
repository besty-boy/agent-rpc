import type {
  DiscordActivityPayload,
  DiscordConnectionState,
  RenderedPresence,
} from '../types.js';
import { DiscordIpcClient } from './ipc.js';

const MIN_UPDATE_INTERVAL_MS = 4_000;
const BASE_BACKOFF_MS = 3_000;
const MAX_BACKOFF_MS = 30_000;

export class DiscordPresenceManager {
  private client: DiscordIpcClient | null = null;
  private activeClientId: string | null = null;
  private lastPayloadHash: string | null = null;
  private lastSentAtMs = 0;
  private lastUpdateAtMs: number | undefined;
  private lastError: string | undefined;
  private backoffMs = BASE_BACKOFF_MS;
  private nextConnectAttemptMs = 0;
  private pendingPresence: RenderedPresence | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private updating = false;

  getState(): DiscordConnectionState {
    return {
      connected: Boolean(this.client?.isConnected),
      clientId: this.client?.isConnected ? this.activeClientId : null,
      socketPath: this.client?.isConnected ? this.client.currentSocketPath : null,
      user: this.client?.user,
      lastUpdateAtMs: this.lastUpdateAtMs,
      lastError: this.lastError,
    };
  }

  async applyPresence(presence: RenderedPresence | null): Promise<void> {
    if (presence === null) {
      this.pendingPresence = null;
      this.clearFlushTimer();
      await this.clear();
      return;
    }

    if (!presence.clientId) {
      this.lastError =
        'No Discord Client ID configured yet. Run "agent-rpc setup" or set defaultClientId in the dashboard.';
      return;
    }

    const hash = this.computeHash(presence.clientId, presence.activity);
    if (hash === this.lastPayloadHash && this.client?.isConnected && this.activeClientId === presence.clientId) {
      return;
    }

    const now = Date.now();
    const isClientSwitch = this.activeClientId !== null && this.activeClientId !== presence.clientId;
    const elapsed = now - this.lastSentAtMs;

    if (!isClientSwitch && this.client?.isConnected && elapsed < MIN_UPDATE_INTERVAL_MS) {
      this.pendingPresence = presence;
      this.scheduleFlush(MIN_UPDATE_INTERVAL_MS - elapsed);
      return;
    }

    this.pendingPresence = null;
    this.clearFlushTimer();
    await this.pushNow(presence, hash);
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.pendingPresence) {
        const next = this.pendingPresence;
        this.pendingPresence = null;
        void this.applyPresence(next);
      }
    }, Math.max(250, delayMs));
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async pushNow(presence: RenderedPresence, hash: string): Promise<void> {
    if (this.updating) {
      this.pendingPresence = presence;
      return;
    }
    this.updating = true;
    try {
      const ok = await this.ensureConnected(presence.clientId);
      if (!ok || !this.client) return;

      await this.client.setActivity(presence.activity);
      this.lastPayloadHash = hash;
      this.lastSentAtMs = Date.now();
      this.lastUpdateAtMs = this.lastSentAtMs;
      this.lastError = undefined;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      // Force fresh reconnect on next cycle if send failed
      await this.disconnectInternal();
    } finally {
      this.updating = false;
      if (this.pendingPresence) {
        this.scheduleFlush(MIN_UPDATE_INTERVAL_MS);
      }
    }
  }

  private async ensureConnected(clientId: string): Promise<boolean> {
    if (this.client?.isConnected && this.activeClientId === clientId) {
      return true;
    }

    const now = Date.now();
    // If switching client IDs intentionally, reconnect immediately without backoff
    const switchingApp = this.activeClientId !== null && this.activeClientId !== clientId;
    if (!switchingApp && now < this.nextConnectAttemptMs) {
      return false;
    }

    await this.disconnectInternal();

    const nextClient = new DiscordIpcClient(clientId);
    nextClient.on('close', () => {
      if (this.client === nextClient) {
        this.lastPayloadHash = null;
      }
    });
    nextClient.on('error', (err: Error) => {
      this.lastError = err.message;
    });

    try {
      await nextClient.connect();
      this.client = nextClient;
      this.activeClientId = clientId;
      this.lastPayloadHash = null;
      this.backoffMs = BASE_BACKOFF_MS;
      this.nextConnectAttemptMs = 0;
      this.lastError = undefined;
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.nextConnectAttemptMs = Date.now() + this.backoffMs;
      this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2);
      return false;
    }
  }

  async clear(): Promise<void> {
    this.lastPayloadHash = null;
    if (this.client?.isConnected) {
      try {
        await this.client.clearActivity();
      } catch {
        // Ignore clear errors on closing socket
      }
    }
  }

  async shutdown(): Promise<void> {
    this.clearFlushTimer();
    this.pendingPresence = null;
    await this.clear();
    await this.disconnectInternal();
  }

  private async disconnectInternal(): Promise<void> {
    if (this.client) {
      const old = this.client;
      this.client = null;
      this.activeClientId = null;
      this.lastPayloadHash = null;
      await old.close();
    }
  }

  private computeHash(clientId: string, activity: DiscordActivityPayload): string {
    return JSON.stringify({ clientId, activity });
  }
}
