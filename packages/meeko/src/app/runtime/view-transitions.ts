/** Coordina las transiciones nativas de una aplicación sin retrasar la carga ni duplicar commits. */
export function createViewTransitionController(browser: Window) {
  let active: ViewTransition | undefined;
  function skip(): void {
    active?.skipTransition();
    active = undefined;
  }
  return {
    skip,
    async commit(update: () => void, signal: AbortSignal, enabled: boolean): Promise<boolean> {
      if (signal.aborted) return false;
      let committed = false;
      let started = false;
      const apply = () => {
        if (signal.aborted) return;
        started = true;
        update();
        committed = true;
      };
      const document = browser.document;
      if (!enabled || typeof document.startViewTransition !== "function" || document.visibilityState === "hidden"
        || (typeof browser.matchMedia === "function" && browser.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
        apply();
        return committed;
      }
      skip();
      let transition: ViewTransition;
      try { transition = document.startViewTransition(apply); }
      catch (error) {
        // A browser failure before the callback falls back; a failed update is never retried.
        if (started) throw error;
        apply();
        return committed;
      }
      active = transition;
      const abort = () => transition.skipTransition();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      // Duplicate names or a skipped animation reject `ready`, not the page's DOM update.
      void transition.ready.catch(() => {});
      void transition.finished.catch(() => {}).then(() => {
        signal.removeEventListener("abort", abort);
        if (active === transition) active = undefined;
      });
      await transition.updateCallbackDone;
      return committed;
    },
  };
}
