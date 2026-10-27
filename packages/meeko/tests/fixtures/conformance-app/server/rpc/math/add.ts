import { defineRpc } from "@meekojs/meeko/server";
import { sum, total } from "../../../shared/schemas.js";

export default defineRpc({
  input: sum,
  output: total,
  handler: ({ input }) => ({ total: input.a + input.b }),
});
