import { defineApiRoute } from "@meekojs/meeko/server";
import { echo, text } from "../../../shared/schemas";

// A webhook from another server sends no Origin: the route opts out of the 1.8 default.
export default defineApiRoute({
  origin: "none",
  body: text,
  response: echo,
  handler: ({ body, context }) => ({ text: body.text, platform: context.platform.name }),
});
