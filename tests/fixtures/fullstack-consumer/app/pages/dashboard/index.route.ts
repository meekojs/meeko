import { definePage } from "@meekojs/meeko/framework";
import type { RequestContext } from "@meekojs/meeko/server";

export const route = definePage<undefined, undefined, Response | { id: string; name: string }, RequestContext>({
  async load({ context }) {
    if (!context?.session.current) return new Response(null, { status: 302, headers: { location: "/" } });
    return rpc.users.get({ id: "dashboard" });
  },
});
