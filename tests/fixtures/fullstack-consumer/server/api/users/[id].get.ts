import { defineApiRoute } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/demo.js";

export default defineApiRoute({
  params: userParams,
  response: userSchema,
  handler: ({ params }) => ({ id: params.id, name: `User ${params.id}` }),
});
