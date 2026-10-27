import { defineSocketChannel } from "@meekojs/meeko/server";
import { chatInput, chatMessage } from "../../shared/schemas/demo.js";

export default defineSocketChannel({
  clientToServer: { message: chatInput },
  serverToClient: { message: chatMessage },
  auth: "required",
  authorize: ({ context, roomId }) => !!context.session.current && (roomId === undefined || roomId === "general"),
  handlers: {
    message: async ({ payload, emit }) => emit("message", payload),
  },
});
