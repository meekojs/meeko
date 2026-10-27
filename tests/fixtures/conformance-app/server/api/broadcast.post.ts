import { defineApiRoute } from "@meekojs/meeko/server";
import { empty, roomText } from "../../shared/schemas.js";

export default defineApiRoute({
  body: roomText,
  response: empty,
  async handler({ body }) {
    // The generated server `socket` validates the event and payload like hub.broadcast.
    await socket.room.broadcast(body.room, "said", { text: body.text });
    return { ok: true as const };
  },
});
