import { createContext, findContext, provide } from "../reactivity.js";
import type { ReadonlySignal } from "../reactivity.js";

/** Navigation status of the browser application that renders a component. */
export interface NavigationState {
  /** `true` from the start of a navigation until its page commits, fails or is cancelled. */
  readonly pending: ReadonlySignal<boolean>;
}

const navigationKey = createContext<NavigationState>("Meeko navigation");

const idle: NavigationState = Object.freeze({ pending: Object.freeze({ value: false }) });

/**
 * Reads the navigation status of the current application. During SSR and
 * outside `mountClientApp`, `pending` is always `false`.
 */
export function useNavigation(): NavigationState {
  return findContext(navigationKey) ?? idle;
}

/** Makes an application's navigation status available to its component tree. */
export function provideNavigation(state: NavigationState): void {
  provide(navigationKey, state);
}
