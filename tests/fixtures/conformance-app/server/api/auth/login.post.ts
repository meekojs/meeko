import { defineApiRoute } from "@meekojs/meeko/server";
import { login } from "../../../shared/schemas.js";

export default defineApiRoute({
  response: login,
  async handler({ context }) {
    const session = await context.session.create({ user: "ada" });
    return { csrf: session.csrfToken };
  },
});
