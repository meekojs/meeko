import { definePlugin } from "@meekojs/meeko/framework";
import { greetingKey } from "./greeting.ts";

/** Universal plugin: the same value on the server and in the browser, so hydration matches. */
export default definePlugin<{ greeting: string }>((app, options) => {
  app.provide(greetingKey, options.greeting);
});
