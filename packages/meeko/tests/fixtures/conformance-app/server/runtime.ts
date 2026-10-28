import { D1SessionDriver, DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";
import type { D1DatabaseLike, DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
import { defineServerRuntime, LocalSocketPubSub, MemorySessionStore, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";
import type { SessionStore, SocketPubSub } from "@meekojs/meeko/server";

interface ConformanceEnv {
  readonly DB?: D1DatabaseLike;
  readonly MEEKO_SOCKET?: DurableObjectNamespaceLike;
}

// One process serves the Node, Bun and Deno suites, so a memory store marked
// persistent stands in for a production store; it implements atomic rotation
// and family revocation. Workers isolates share nothing, so the workerd suite
// keeps sessions in D1 and routes Socket rooms through Durable Objects.
export default defineServerRuntime<ConformanceEnv>(({ env, production, platform, prerendering }) => {
  const workers = platform === "cloudflare" && !prerendering;
  let store: SessionStore;
  let pubsub: SocketPubSub;
  if (workers) {
    store = new SqlSessionStore(new D1SessionDriver(env.DB!));
    pubsub = new DurableObjectSocketPubSub(env.MEEKO_SOCKET!);
  } else {
    const memory = new MemorySessionStore();
    store = {
      persistent: true,
      get: (id) => memory.get(id),
      set: (record) => memory.set(record),
      delete: (id) => memory.delete(id),
      replace: (oldId, record) => memory.replace(oldId, record),
      revokeFamily: (familyId) => memory.revokeFamily(familyId),
      close: () => memory.close(),
    };
    pubsub = new LocalSocketPubSub();
  }
  return {
    sessions: new SessionManager({ secure: false, production, store }),
    services: { pubsub },
    socket: { pubsub, maxMessageBytes: 1024 },
    // One line per failure, so the suite can find what each output observed.
    onError: (error, requestId, info) => {
      console.log(`[conformance:onError] ${JSON.stringify({ message: error instanceof Error ? error.message : String(error), requestId, info: info ?? null })}`);
    },
  };
});
