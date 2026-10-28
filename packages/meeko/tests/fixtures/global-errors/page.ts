import type { ClientComponent } from "../../../src/framework/client.ts";
import { createRouteManifest } from "../../../src/framework/router.ts";

/** The page of the real-browser test of global errors: plain DOM buttons that fail outside Meeko. */
const html = [
  `<button id="timer">timer</button>`,
  `<button id="reject">reject</button>`,
  `<button id="reported">reported</button>`,
  `<button id="dispose">dispose</button>`,
].join("");

export const routes = createRouteManifest([{ id: "/", file: "page.meeko", layouts: [] }]);

export const page: ClientComponent = {
  renderWithState: () => ({ html, state: {} }),
  renderToString: () => html,
  hydrateScope: () => () => {},
};
