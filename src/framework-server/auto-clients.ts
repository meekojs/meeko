import { currentRequest } from "./context.js";
import type { ClientOptions } from "../framework/clients.js";

/** Dynamic options prevent a module-level client from retaining any user's credentials. */
export function createServerClientOptions(): ClientOptions {
  return {
    baseUrl: () => currentRequest().context.request.url,
    headers: () => {
      const request = currentRequest().context.request;
      const headers = new Headers();
      for (const name of ["cookie", "authorization"]) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      headers.set("origin", new URL(request.url).origin);
      return headers;
    },
    csrfToken: () => currentRequest().context.session.current?.csrfToken,
    fetch: async (input, init) => {
      const active = currentRequest();
      const request = new Request(input, init);
      if (active.serverFetch) return active.serverFetch(request, active.context);
      return fetch(request);
    },
  };
}
