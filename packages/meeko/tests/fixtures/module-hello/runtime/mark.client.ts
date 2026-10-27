import { effect } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";
// Provided by the module's Vite plugin.
import { info } from "virtual:hello-info";

// Replaced by the module's extendViteConfig.
declare const __HELLO_MARK__: string;

/** Client plugin: runs once in the browser, before hydration. */
export default definePlugin<{ mark: string }>((app, options) => {
  const root = document.documentElement;
  root.dataset.helloClient = `${options.mark}:${app.side}:${String(app.request)}`;
  root.dataset.helloVite = info;
  root.dataset.helloDefine = __HELLO_MARK__;
  // The plugin route follows client navigations.
  effect(() => { root.dataset.helloRoute = app.route.path.value; });
  app.onError((error, info) => { root.dataset.helloError = `${info.side}:${error instanceof Error ? error.message : String(error)}`; });
});
