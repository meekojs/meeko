import { defineSocketChannel } from "@meekojs/meeko/server";
import type { SocketPubSub } from "@meekojs/meeko/server";
import { ack, roomText, sequence, text } from "../../shared/schemas.js";

export default defineSocketChannel({
  clientToServer: { say: text, seq: sequence, relay: roomText },
  serverToClient: { said: text, ack: ack },
  handlers: {
    // Published through the runtime's pub/sub so every peer in the room receives it.
    say: async ({ payload, context, roomId }) => {
      const { pubsub } = context.services as { pubsub: SocketPubSub };
      await pubsub.publish("room", roomId ?? "", { event: "said", payload });
    },
    // Later messages wait for earlier ones even when they would finish sooner.
    seq: async ({ payload, emit }) => {
      await new Promise((resolve) => setTimeout(resolve, payload.delay));
      await emit("ack", { n: payload.n });
    },
    // Publishes to another room, which may live in another instance or Durable Object,
    // through the generated server `socket`, bound to the hub that runs this handler.
    relay: async ({ payload }) => {
      await socket.room.broadcast(payload.room, "said", { text: payload.text });
    },
  },
});
