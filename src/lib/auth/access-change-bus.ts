import "server-only";
import pg, { type Client as PgClient } from "pg";
import { readAccessChangeUserId } from "./access-change-event";

// One dedicated LISTEN connection per Railway Node process, not one per user.
// AUTH_EVENTS_DATABASE_URL MUST be a direct/session-pooled PostgreSQL URL:
// transaction-pooled connections cannot reliably LISTEN across transactions.
const { Client: PgClientCtor } = pg;
type Listener = () => void;
type Subscription = { close(): void; ready: Promise<boolean> };

class AccessChangeBus {
  private listeners = new Map<string, Set<Listener>>();
  private connection: PgClient | null = null;
  private connecting: Promise<boolean> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(userId: string, onChange: Listener): Subscription {
    const bucket = this.listeners.get(userId) ?? new Set<Listener>();
    bucket.add(onChange);
    this.listeners.set(userId, bucket);
    return {
      close: () => {
        bucket.delete(onChange);
        if (bucket.size === 0) this.listeners.delete(userId);
        if (this.listeners.size === 0) this.shutdown();
      },
      ready: this.connect(),
    };
  }

  private shutdown() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const client = this.connection;
    this.connection = null;
    if (client) void client.end().catch(() => undefined);
  }

  private scheduleReconnect() {
    if (this.retryTimer || this.listeners.size === 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, 5000);
    this.retryTimer.unref?.();
  }

  private async connect(): Promise<boolean> {
    if (this.connection) return true;
    if (this.connecting) return this.connecting;
    const url = process.env.AUTH_EVENTS_DATABASE_URL;
    if (!url || this.listeners.size === 0) return false;

    const attempt = (async (): Promise<boolean> => {
      const client: PgClient = new PgClientCtor({
        connectionString: url,
        connectionTimeoutMillis: 5000,
        keepAlive: true,
      });
      client.on("notification", (message) => {
        if (message.channel !== "la_access_changed") return;
        const userId = readAccessChangeUserId(message.payload);
        if (!userId) return;
        for (const listener of this.listeners.get(userId) ?? []) {
          try { listener(); } catch { /* one broken SSE cannot break others */ }
        }
      });
      const lost = () => {
        if (this.connection !== client) return;
        this.connection = null;
        void client.end().catch(() => undefined);
        this.scheduleReconnect();
      };
      client.on("error", lost);
      client.on("end", lost);
      try {
        await client.connect();
        await client.query("LISTEN la_access_changed");
        if (this.listeners.size === 0) {
          await client.end().catch(() => undefined);
          return false;
        }
        this.connection = client;
        // Refresh once at initial subscribe/reconnect to recover events that
        // may have occurred while there was no LISTEN connection. This is not
        // per-click polling; the data remains server-authoritative.
        for (const bucket of this.listeners.values()) {
          for (const listener of bucket) {
            try { listener(); } catch { /* isolate subscribers */ }
          }
        }
        return true;
      } catch {
        console.error("[auth-events] PostgreSQL LISTEN unavailable; live navigation updates degraded");
        await client.end().catch(() => undefined);
        this.scheduleReconnect();
        return false;
      }
    })();
    this.connecting = attempt;
    try { return await attempt; } finally { if (this.connecting === attempt) this.connecting = null; }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __learnersAreaAccessChangeBus: AccessChangeBus | undefined;
}

/** Minimal authenticated subscriber. Not used to grant or revoke permissions. */
export function subscribeAccessChanges(userId: string, onChange: Listener): Subscription {
  const bus = globalThis.__learnersAreaAccessChangeBus ??= new AccessChangeBus();
  return bus.subscribe(userId, onChange);
}
