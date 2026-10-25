import { defineApiRoute } from "@meekojs/meeko/server";
import type { SocketPubSub } from "@meekojs/meeko/server";
import { empty, roomText } from "../../shared/schemas.js";

export default defineApiRoute({
  body: roomText,
  response: empty,
  async handler({ body, context }) {
    const { pubsub } = context.services as { pubsub: SocketPubSub };
    await pubsub.publish("room", body.room, { event: "said", payload: { text: body.text } });
    return { ok: true as const };
  },
});
