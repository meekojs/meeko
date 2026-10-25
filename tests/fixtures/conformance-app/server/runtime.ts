import { defineServerRuntime, LocalSocketPubSub, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

// One process serves the suite, so a memory store marked persistent stands in
// for a production store; it implements atomic rotation and family revocation.
export default defineServerRuntime(({ production }) => {
  const memory = new MemorySessionStore();
  const pubsub = new LocalSocketPubSub();
  return {
    sessions: new SessionManager({
      secure: false, production, store: {
        persistent: true,
        get: (id) => memory.get(id),
        set: (record) => memory.set(record),
        delete: (id) => memory.delete(id),
        replace: (oldId, record) => memory.replace(oldId, record),
        revokeFamily: (familyId) => memory.revokeFamily(familyId),
        close: () => memory.close(),
      },
    }),
    services: { pubsub },
    socket: { pubsub, maxMessageBytes: 1024 },
  };
});
