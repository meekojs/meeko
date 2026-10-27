import { defineApiRoute } from "@meekojs/meeko/server";
import { createUserBody, userSchema } from "../../../shared/schemas/demo.js";

export default defineApiRoute({
  body: createUserBody,
  response: userSchema,
  handler: ({ body }) => ({ id: "2", name: body.name }),
});
