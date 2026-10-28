import { isAbsolute, relative } from "node:path";
import { builtinComponentModules } from "../compiler.js";

/**
 * Files whose addition or removal changes what Meeko discovers: routes,
 * layouts, error pages, route middleware, app plugins and the server API, RPC,
 * Socket and middleware modules. Paths are relative to a source root, with `/`.
 */
const discoveryPath = /^(?:app\/(?:pages|layouts|middleware|plugins)\/|app\/(?:app|error)\.meeko$|server\/(?:api|rpc|socket|middleware)\/)/;

/** Whether `file` is a discovery input of one of `sourceRoots` (the project and its layers or modules). */
export function isDiscoverySource(file: string, sourceRoots: readonly string[]): boolean {
  return sourceRoots.some((root) => {
    const path = relative(root, file).replaceAll("\\", "/");
    return !path.startsWith("../") && path !== ".." && discoveryPath.test(path);
  });
}

/**
 * Whether `file` holds route options that discovery reads without running them: a page (its
 * `<script server>`), a `*.route.ts` sidecar or a `+group.ts` under `app/pages` of a source root.
 * Editing one may change `render` or the layout of routes.
 */
export function isRouteOptionsSource(file: string, sourceRoots: readonly string[]): boolean {
  return sourceRoots.some((root) => {
    const path = relative(root, file).replaceAll("\\", "/");
    return path.startsWith("app/pages/") && (path.endsWith(".meeko") || path.endsWith(".route.ts") || path.endsWith("/+group.ts"));
  });
}

/** What a route manifest says about each route's render and layouts, to compare two discoveries. */
export function routeOptionsKey(routes: readonly { readonly id: string; readonly layouts: readonly string[]; readonly render?: string; readonly layout?: unknown }[]): string {
  return JSON.stringify(routes.map((route) => [route.id, route.layouts, route.render ?? null, route.layout ?? null]));
}

/**
 * Whether the dev watcher skips `file`: everything under a `.meeko` directory of
 * `root` except `.meeko/generated`, the entries Vite serves. `meeko check`, the
 * language server, type generation and builds rewrite the rest while `meeko dev`
 * runs, and a stale build output can hold thousands of files; watching them
 * would reload the browser on every check and slow the server start.
 *
 * The rule applies to the path relative to `root`, so a project that itself
 * lives under some `.meeko` directory keeps its own sources watched. Paths
 * outside `root` are never skipped.
 */
export function isDevWatchIgnored(file: string, root: string): boolean {
  const path = relative(root, file).replaceAll("\\", "/");
  if (path === ".." || path.startsWith("../") || isAbsolute(path)) return false;
  const segments = path.split("/").filter(Boolean);
  for (let index = 0; index < segments.length - 1; index++) {
    if (segments[index] === ".meeko" && segments[index + 1] !== "generated") return true;
  }
  return false;
}

/** The app `meeko dev` serves and the triggers that replace it; see {@link createDevAppReloader}. */
export interface DevAppReloader<T> {
  /** The app that answers the next request; pending while its replacement is built. */
  readonly current: Promise<T>;
  /**
   * Runs `run` with the app once no replacement is pending, and counts it as in flight until it
   * settles: a restart lets it finish on the module runner it started on before closing that runner.
   */
  use<R>(run: (app: T) => Promise<R>): Promise<R>;
  /** Replaces the app after a discovery change. Changes within the coalescing delay make one replacement. */
  rebuild(): void;
  /**
   * Runs the Vite restart `start` once the requests and the replacement in flight have finished
   * (or after the drain timeout), and replaces the app once the restart settles, resolved or
   * rejected. Requests wait from this call on: the restart closes the module runner the current
   * app loads its modules through. Resolves or rejects as `start` does.
   */
  restart<R>(start: () => Promise<R>): Promise<R>;
}

/**
 * Serializes the replacements of the development app. One replacement is pending at a
 * time: a discovery change and a restart that coincide build a single app, after the restart.
 * `replace` builds the next app from the previous one and resolves to the app that serves
 * from then on; it must not reject (it returns the previous app when the new one fails).
 * `superseded()` tells it whether a restart began while it was building: the app is then built
 * again after that restart, so a failure of this one needs no report.
 *
 * A restart closes the module runner of the old Vite server. A request or a replacement that
 * started before it still loads modules through that runner ("transport was disconnected",
 * "module runner has been closed"), so the restart waits for them, up to `drainTimeout`
 * milliseconds; requests that arrive meanwhile wait for the app built after the restart.
 */
export function createDevAppReloader<T>(
  initial: T,
  replace: (prior: T, superseded: () => boolean) => Promise<T>,
  delay = 25,
  drainTimeout = 5_000,
): DevAppReloader<T> {
  let current: Promise<T> = Promise.resolve(initial);
  let queued = false;
  /** Every Vite restart in flight, settled together. */
  let restarting: Promise<unknown> | undefined;
  /** Restarts begun so far, to tell a replacement that one began while it was building. */
  let restarts = 0;
  /** Requests and the replacement running on the module runner of the current Vite server. */
  let active = 0;
  const idle = new Set<() => void>();
  const release = (): void => {
    active--;
    if (active === 0) for (const done of [...idle]) done();
  };
  const drained = (): Promise<void> => active === 0 ? Promise.resolve() : new Promise((done) => {
    const finish = (): void => { clearTimeout(timer); idle.delete(finish); done(); };
    const timer = setTimeout(finish, drainTimeout);
    idle.add(finish);
  });
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    const previous = current;
    current = (async () => {
      const prior = await previous;
      // Coalesces the events of a file tree created or removed at once.
      await new Promise((done) => setTimeout(done, delay));
      // The app must load through the module runner of the server that results from the restart.
      while (restarting) {
        const waiting = restarting;
        await waiting;
        if (restarting === waiting) restarting = undefined;
      }
      queued = false;
      const begun = restarts;
      active++;
      try { return await replace(prior, () => restarts !== begun); }
      finally { release(); }
    })();
  };
  return {
    get current() { return current; },
    async use(run) {
      // A replacement scheduled while this request waited (a restart, a discovery change) is waited for too.
      let pending: Promise<T>;
      let app: T;
      do {
        pending = current;
        app = await pending;
      } while (pending !== current);
      active++;
      try { return await run(app); }
      finally { release(); }
    },
    rebuild: schedule,
    restart(start) {
      restarts++;
      let settle!: () => void;
      const settled = new Promise<void>((done) => { settle = done; });
      restarting = restarting ? Promise.all([restarting, settled]) : settled;
      schedule();
      const running = drained().then(start);
      void running.then(settle, settle);
      return running;
    },
  };
}

/**
 * Dependency-scan globs that keep Vite's optimizer out of `.meeko`, where a
 * previous build leaves prerendered HTML. They are negated `optimizeDeps.entries`
 * patterns, relative to the Vite root.
 */
export const devScanIgnored: readonly string[] = ["!**/.meeko/**"];

/**
 * `optimizeDeps.include` of the browser in `meeko dev`: the modules of Meeko's own components
 * (`@meekojs/meeko/builtins/*`), which only the pages that use their tags import. Pages load
 * with `import()`, so Vite would find them on the first visit to such a page, optimize them
 * again and reload it. Only when Vite optimizes Meeko (installed in `node_modules`, not linked
 * from a workspace and not in `optimizeDeps.exclude`): including them from a linked copy would
 * bundle a second runtime.
 */
export function builtinOptimizeInclude(runtime: string, exclude: readonly string[] | undefined): string[] {
  if (!runtime.replaceAll("\\", "/").includes("/node_modules/")) return [];
  if (exclude?.some((entry) => entry === "@meekojs/meeko" || entry.startsWith("@meekojs/meeko/"))) return [];
  return Object.values(builtinComponentModules).map((module) => module.specifier);
}
