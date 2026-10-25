import { defineApiRoute } from "@meekojs/meeko/server";
import { echo, text } from "../../shared/schemas.js";

export default defineApiRoute({
  body: text,
  response: echo,
  handler: ({ body, context }) => ({ text: body.text, platform: context.platform.name }),
});
