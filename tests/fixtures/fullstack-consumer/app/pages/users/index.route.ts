import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  load: async () => api.users.get(),
  head: ({ data }) => ({ title: `Users: ${data.name}` }),
});
