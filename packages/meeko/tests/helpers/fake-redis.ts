// An in-memory stand-in for a node-redis client: the commands and Lua scripts that Meeko's
// RedisSessionStore sends, plus connect/duplicate/subscribe/close, so tests can check the wiring of
// the session defaults and rate limits without a server.

type Listener = (message: string, channel: string) => void;

/** State shared by a client and its duplicates, as one Redis server. */
export class FakeRedisServer {
  readonly records = new Map<string, { value: string; expiresAt: number }>();
  readonly channels = new Map<string, Set<Listener>>();
  readonly clients: FakeRedis[] = [];
  /** Every Lua script name that reached the server, in order. */
  readonly scripts: string[] = [];
  down = false;
  failConnect = false;
  publish(channel: string, message: string): void {
    for (const listener of [...this.channels.get(channel) ?? []]) listener(message, channel);
  }
  read(key: string): string | null {
    const row = this.records.get(key);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) { this.records.delete(key); return null; }
    return row.value;
  }
  write(key: string, value: string, px: number): void {
    this.records.set(key, { value, expiresAt: Date.now() + px });
  }
}

/** A node-redis-like client created by {@link fakeRedisModule}. */
export class FakeRedis {
  readonly listeners = new Map<string, Set<(error: unknown) => void>>();
  connected = false;
  closed = false;
  constructor(readonly server: FakeRedisServer, readonly options: Record<string, unknown>) {
    server.clients.push(this);
  }
  on(event: string, listener: (error: unknown) => void): this {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(listener);
    return this;
  }
  async connect(): Promise<this> {
    if (this.server.failConnect) {
      const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), { code: "ECONNREFUSED" });
      for (const listener of this.listeners.get("error") ?? []) listener(error);
      throw error;
    }
    this.connected = true;
    return this;
  }
  duplicate(overrides: Record<string, unknown> = {}): FakeRedis {
    return new FakeRedis(this.server, { ...this.options, ...overrides });
  }
  async close(): Promise<void> { this.closed = true; this.connected = false; }
  destroy(): void { this.closed = true; this.connected = false; }
  private ready(): void {
    if (!this.connected || this.server.down) throw new Error("The client is closed");
  }
  async get(key: string): Promise<string | null> { this.ready(); return this.server.read(key); }
  async set(key: string, value: string, options: { PX: number }): Promise<string> { this.ready(); this.server.write(key, value, options.PX); return "OK"; }
  async del(key: string): Promise<number> { this.ready(); return this.server.records.delete(key) ? 1 : 0; }
  async subscribe(channel: string, listener: Listener): Promise<void> {
    this.ready();
    let set = this.server.channels.get(channel);
    if (!set) { set = new Set(); this.server.channels.set(channel, set); }
    set.add(listener);
  }
  async unsubscribe(channel: string, listener: Listener): Promise<void> {
    this.server.channels.get(channel)?.delete(listener);
  }
  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    this.ready();
    const server = this.server;
    const name = /^-- (meeko:[\w:-]+)/.exec(script)?.[1] ?? "unknown";
    server.scripts.push(name);
    const [first, second, third] = options.keys;
    const args = options.arguments;
    if (!first) throw new Error("Missing Redis key");
    if (name === "meeko:session:set") {
      const prior = server.read(first);
      if (prior) {
        const old = JSON.parse(prior) as { id: string; familyId?: string };
        if ((old.familyId ?? old.id) !== args[3]) return 0;
      }
      const active = server.read(second!);
      if (active && active !== args[1]) return 0;
      server.write(first, args[0]!, Number(args[2]));
      server.write(second!, args[1]!, Number(args[2]));
      return 1;
    }
    if (name === "meeko:session:replace") {
      const previousRaw = server.read(first);
      if (!previousRaw) return 0;
      const previous = JSON.parse(previousRaw) as { id: string; familyId?: string; expiresAt: number };
      if ((previous.familyId ?? previous.id) !== args[2] || previous.expiresAt <= Number(args[3])) return 0;
      const active = server.read(third!);
      if (active && active !== args[1]) return 0;
      server.write(second!, args[0]!, Number(args[4]));
      server.write(third!, args[5]!, Number(args[4]));
      server.records.delete(first);
      return 1;
    }
    if (name === "meeko:session:delete") {
      if (!server.read(first)) return 0;
      const active = server.read(second!);
      server.records.delete(first);
      if (active === args[0]) server.records.delete(second!);
      return 1;
    }
    if (name === "meeko:session:revoke-family") {
      const active = server.read(first);
      server.records.delete(`${args[0]}${active ?? args[1]}`);
      server.records.delete(first);
      server.publish(args[2]!, args[1]!);
      return 1;
    }
    if (name === "meeko:rate-limit") {
      const now = Date.now();
      const row = server.records.get(first);
      const count = row && row.expiresAt > now ? Number(row.value) + 1 : 1;
      const expiresAt = row && row.expiresAt > now ? row.expiresAt : now + Number(args[0]);
      server.records.set(first, { value: String(count), expiresAt });
      return [count, expiresAt - now];
    }
    throw new Error(`Unexpected Redis script ${name}`);
  }
}

/** A module shaped like `import("redis")`, recording each client it creates. */
export function fakeRedisModule(server = new FakeRedisServer()): { server: FakeRedisServer; module: { createClient(options: Record<string, unknown>): FakeRedis } } {
  return { server, module: { createClient: (options) => new FakeRedis(server, options) } };
}
