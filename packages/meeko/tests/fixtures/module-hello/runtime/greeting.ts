import { createContext, inject } from "@meekojs/meeko";

/** Context of the greeting that the universal plugin provides. */
export const greetingKey = createContext<string>("hello greeting");

/** Autoimported by the module: reads the greeting the plugin provided. */
export function useHelloGreeting(): string {
  return inject(greetingKey);
}
