import { defineRpc } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/demo.js";

export default defineRpc({
  input: userParams,
  output: userSchema,
  auth: "required",
  handler: ({ input, context }) => ({ id: input.id, name: String((context.session.current?.data as { user: string }).user) }),
});
