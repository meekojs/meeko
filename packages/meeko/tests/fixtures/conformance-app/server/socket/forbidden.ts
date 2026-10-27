import { defineSocketChannel } from "@meekojs/meeko/server";
import { text } from "../../shared/schemas.js";

// Every handshake is refused by the channel's authorization, never by its session.
export default defineSocketChannel({
  clientToServer: { say: text },
  serverToClient: { said: text },
  authorize: () => false,
  handlers: { say: ({ payload, emit }) => emit("said", payload) },
});
