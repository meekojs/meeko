/**
 * The browser continuation of a component script: the statements from its first browser
 * `await` (`await useElementRef(...)`, `await useSocket(...)`) onward.
 *
 * The compiler moves them into an async function that starts once the component has hydrated
 * or mounted. After every `await` the continuation resumes the component's root, so effects,
 * `onCleanup` and composables it creates belong to the component. Releasing the component
 * cancels it: a pending `await` never resumes.
 */
import { componentErrorReporter } from "./component-errors.js";
import { browserValue } from "./element-refs.js";
import type { UnexposedRef, UnexposedRefMessage } from "./element-refs.js";
import { enterMountedScope, whenMounted } from "./lifecycle.js";
import { createRoot, currentEffectOwner, onCleanup, switchOwner } from "./reactivity.js";

/** Unwinds a continuation whose component was released while it waited. */
const cancelled: unique symbol = Symbol("meeko.continuationCancelled");

/** Handle the compiled continuation uses around each `await`. */
export class BrowserContinuation {
  readonly #owner: object | undefined;
  #restore: (() => void) | undefined;
  #disposed = false;

  constructor(owner: object | undefined) {
    this.#owner = owner;
  }

  /** Resumes the component root; idempotent. */
  enter(): void {
    if (this.#restore) return;
    const restoreOwner = switchOwner(this.#owner);
    const restoreScope = enterMountedScope();
    this.#restore = () => { restoreScope(); restoreOwner(); };
  }

  /** Leaves the component root before the continuation yields; idempotent. */
  exit(): void {
    const restore = this.#restore;
    this.#restore = undefined;
    restore?.();
  }

  /**
   * `await ctx.wait(value)`: leaves the root and waits for the element, the socket or the data.
   * The ref of a component without `defineExpose` is a type error (MEEK080).
   */
  wait<T>(value: T & ([T] extends [UnexposedRef] ? UnexposedRefMessage : unknown)): Promise<Awaited<T>> {
    this.exit();
    return browserValue(value);
  }

  /** Re-enters the root after an `await`, or unwinds if the component was released meanwhile. */
  resume<T>(value: T): T {
    if (this.#disposed) throw cancelled;
    this.enter();
    return value;
  }

  dispose(): void {
    this.#disposed = true;
    this.exit();
  }
}

/**
 * Starts `body` once the component is mounted in the browser, in a child root that the component
 * releases. A failure reaches the component error observer with the source `"mounted"`.
 */
export function continueInBrowser(body: (context: BrowserContinuation) => Promise<void>): void {
  whenMounted(() => {
    createRoot(() => {
      const context = new BrowserContinuation(currentEffectOwner());
      const report = componentErrorReporter("mounted");
      onCleanup(() => context.dispose());
      let running: Promise<void>;
      context.enter();
      try { running = body(context); }
      finally { context.exit(); }
      running.catch((error: unknown) => {
        if (error !== cancelled) report(error);
      });
    });
  });
}
