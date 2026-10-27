import { defineApiRoute } from "@meekojs/meeko/server";
import { userSchema } from "../../../shared/schemas/demo.js";

export default defineApiRoute({
  response: userSchema,
  handler: () => ({ id: "1", name: "Ada" }),
});
