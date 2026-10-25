import { definePage } from "@meekojs/meeko/framework";

// Rendered in the browser: the loader calls the public API instead of server code.
export const route = definePage({
  render: "client",
  load: async () => api.users.get(),
  head: ({ data }) => ({ title: `Notes: ${data.name}` }),
});
