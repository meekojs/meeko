import { defineSocketChannel } from "@meekojs/meeko/server";
import { text } from "../../shared/schemas.js";

export default defineSocketChannel({
  clientToServer: { say: text },
  serverToClient: { said: text },
  auth: "required",
  handlers: { say: ({ payload, emit }) => emit("said", payload) },
});
