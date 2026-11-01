import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

// The documentation site has no accounts or RPC: every page is public, and nothing creates a session.
// Its only API routes collect the metrics (server/api/docs/*.post.ts) without cookies. The in-memory
// store backs the framework's session context and the counters of their `rateLimit` (per instance),
// so the manager runs in its non-production mode, which accepts that store.
export default defineServerRuntime(() => ({
  sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),
}));
