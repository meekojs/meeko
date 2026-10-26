import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

// The documentation site has no accounts, API or RPC: every page is public and prerendered, and
// nothing creates a session or sets a cookie. The in-memory store only backs the framework's
// session context, so the manager runs in its non-production mode, which accepts that store.
export default defineServerRuntime(() => ({
  sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),
}));
