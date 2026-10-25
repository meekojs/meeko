import { definePage } from "@meekojs/meeko/framework";

// The loader calls the API in-process, through the same runtime and platform.
export const route = definePage({
  load: async () => api.trace.get(),
});
