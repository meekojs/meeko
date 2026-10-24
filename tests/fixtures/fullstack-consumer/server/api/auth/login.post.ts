import { defineApiRoute } from "@meekojs/meeko/server";
import { loginBody, loginResult } from "../../../shared/schemas/demo.js";

export default defineApiRoute({
  body: loginBody,
  response: loginResult,
  async handler({ body, context }) {
    const session = await context.session.create({ user: body.user });
    return { user: body.user, csrfToken: session.csrfToken };
  },
});
