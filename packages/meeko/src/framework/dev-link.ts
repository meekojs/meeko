import type { ChildProcess } from "node:child_process";
import type { FSWatcher, Stats } from "node:fs";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

/** Package whose rebuilds restart a supervised `meeko dev`. */
const packageName = "@meekojs/meeko";
/** Set on the `meeko dev` process a supervisor starts; that process never supervises another. */
export const supervisedDevelopmentEnv = "MEEKO_DEV_SUPERVISED";
/**
 * HTTP and HMR ports a supervisor passes to every server after the first: they listen where the
 * first one did, even when it had to skip a port in use, so the browser keeps its URL.
 */
export const supervisedPortEnv = "MEEKO_DEV_SUPERVISED_PORT";
export const supervisedHmrPortEnv = "MEEKO_DEV_SUPERVISED_HMR_PORT";
/** `MEEKO_LINK_WATCH=0` keeps `meeko dev` in one process that ignores rebuilds of a linked Meeko. */
export const linkWatchEnv = "MEEKO_LINK_WATCH";
/** Quiet time after the last change of the linked build before restarting. */
export const linkSettleDelay = 400;
const stopMessage = "meeko:dev-stop";
const readyMessage = "meeko:dev-ready";

/** A `@meekojs/meeko` that the app resolves outside every `node_modules`: `link:`, `npm link` or a workspace. */
export interface LinkedMeeko {
  /** Real directory of the package. */
  readonly directory: string;
  /** Its build output, `<directory>/dist`. */
  readonly dist: string;
}

/**
 * The `@meekojs/meeko` that Node resolves from `root` when it is linked, or `undefined`
 * for a registry install or when the app does not resolve it. A registry install lives in
 * some `node_modules`, even when the app reaches it through a symlink or junction (the
 * pnpm store, its global virtual store); a linked package resolves to its own checkout.
 */
export function findLinkedMeeko(root: string): LinkedMeeko | undefined {
  let entry: string;
  try {
    // Node returns the real path, past every symlink and junction.
    entry = createRequire(join(root, "noop.js")).resolve(packageName);
  } catch {
    return undefined;
  }
  let directory = dirname(entry);
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name === packageName) break;
      } catch {
        // An unreadable manifest of a nested directory: keep looking above it.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  if (directory.split(sep).includes("node_modules")) return undefined;
  return { directory, dist: join(directory, "dist") };
}

/** Names of the packages a manifest needs to run: its dependencies and peer dependencies, without its dev tools. */
function runtimeDependencies(manifest: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }): string[] {
  return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})];
}

function readManifest(directory: string): { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> } | undefined {
  try {
    return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as ReturnType<typeof readManifest>;
  } catch {
    return undefined;
  }
}

/** Real directory of a package as `from` reaches it through `node_modules`, walking up the tree. */
function installedPackage(from: string, name: string): string | undefined {
  for (let directory = from; ; directory = dirname(directory)) {
    try {
      return realpathSync(join(directory, "node_modules", name));
    } catch {
      // Not installed at this level.
    }
    if (dirname(directory) === directory) return undefined;
  }
}

/**
 * The other packages built for Meeko that `root` links, directly or through another linked one,
 * such as `@meekojs/ui` in a workspace. `pnpm build` writes them after Meeko, so a server started
 * meanwhile can find their `dist` halfway: {@link superviseDevelopment} waits for them as well.
 * A package counts if it depends on Meeko and has a `dist`; a registry install never does.
 */
export function findLinkedPackages(root: string): LinkedMeeko[] {
  const found = new Map<string, LinkedMeeko>();
  const visited = new Set<string>();
  const visit = (directory: string, names: readonly string[]): void => {
    if (visited.has(directory)) return;
    visited.add(directory);
    for (const name of names) {
      if (name === packageName) continue;
      const target = installedPackage(directory, name);
      if (!target || target.split(sep).includes("node_modules")) continue;
      const manifest = readManifest(target);
      if (!manifest) continue;
      const dependencies = runtimeDependencies(manifest);
      if (dependencies.includes(packageName) && existsSync(join(target, "dist"))) found.set(target, { directory: target, dist: join(target, "dist") });
      visit(target, dependencies);
    }
  };
  const manifest = readManifest(root);
  if (manifest) visit(root, [...runtimeDependencies(manifest), ...Object.keys(manifest.devDependencies ?? {})]);
  return [...found.values()];
}

/** Whether `meeko dev` may supervise itself: not opted out and not already supervised. */
export function linkWatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[linkWatchEnv] !== "0" && env[supervisedDevelopmentEnv] !== "1";
}

/** Runs a function once its triggers stop for a quiet period; see {@link createSettleDebounce}. */
export interface SettleDebounce {
  /** Starts or extends the quiet period. */
  trigger(): void;
  /** Drops a pending run. */
  cancel(): void;
  /** Whether a run is waiting for the quiet period to end. */
  readonly pending: boolean;
}

/**
 * Calls `run` once `delay` milliseconds pass without a {@link SettleDebounce.trigger}: a
 * `tsc` build writes hundreds of files, and the server restarts once after the last one.
 */
export function createSettleDebounce(delay: number, run: () => void): SettleDebounce {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; run(); }, delay);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    get pending() { return timer !== undefined; },
  };
}

/** Quiet time after the last event of the linked build before its files are compared with the last known state. */
const linkVerifyDelay = 100;
/** Margin for file times that run ahead of `Date.now()`: a file stamped within it of the load is not newer than it. */
const clockTolerance = 250;

/**
 * State of the files that make a build of `linked`: a digest of the path, modification time and
 * size of each file under `dist` and of `package.json`, and the newest modification or change time
 * among them. `fs.watch` also wakes up for events that are not writes (reads that update the access
 * time, a watcher that ends, an event without a name): comparing two digests tells whether the
 * build really changed. A missing `dist` has its own digest, and an entry that disappears while it
 * is read is left out.
 */
function scanBuild(linked: LinkedMeeko): { digest: string; newest: number } {
  const hash = createHash("sha1");
  let newest = 0;
  const add = (file: string): void => {
    try {
      const stats = statSync(file);
      newest = Math.max(newest, stats.mtimeMs, stats.ctimeMs);
      hash.update(`${file}\0${stats.mtimeMs}\0${stats.size}\n`);
    } catch {
      // Removed meanwhile: absent from the digest.
    }
  };
  add(join(linked.directory, "package.json"));
  try {
    const files = readdirSync(linked.dist, { recursive: true, withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
    hash.update(`dist ${files.length}\n`);
    for (const file of files) add(file);
  } catch {
    hash.update("no dist\n");
  }
  return { digest: hash.digest("hex"), newest };
}

/** Options of {@link watchLinkedMeeko}. */
export interface WatchLinkedMeekoOptions {
  /** Whether the watchers keep the process alive, as `fs.watch`'s option; `true` by default. */
  persistent?: boolean;
  /** Quiet time after the last event before the build is compared with its last known state; 100 ms by default. */
  verifyDelay?: number;
  /**
   * Time, in milliseconds since the epoch, at which the process loaded the build. A file written
   * clearly after it (a quarter of a second) and before the watch started is reported as a change; without it the build
   * found when the watch starts is taken as the one in use.
   */
  loadedAt?: number;
  /** Replaces `fs.watch`; for tests that inject events the platform does not produce on demand. */
  watch?: typeof watch;
}

/**
 * Tells writes from reads among the `change` events of the files of a linked Meeko. Windows
 * reports a read as a `change` when it updates the file's last access time (at most once an hour
 * per file, while that update is on, its default on many systems): a server loading `dist`, or
 * Vite serving one of its modules, would restart the server it belongs to. A file whose
 * modification or change time, or size, differs from the last event's changed; the first event of
 * a file counts when those times are not older than the watch (less the clock tolerance: a write right after the watch starts can be stamped a few milliseconds before it).
 */
function createWriteFilter(): (file: string) => boolean {
  const since = Date.now();
  const seen = new Map<string, string>();
  return (file) => {
    let stats: Stats;
    try {
      stats = statSync(file);
    } catch {
      // Removed or replaced while the build writes: that is a change.
      seen.delete(file);
      return true;
    }
    // A directory reports its entries being listed; new and removed entries arrive as renames.
    if (stats.isDirectory()) return false;
    const signature = `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`;
    const previous = seen.get(file);
    seen.set(file, signature);
    return previous === undefined ? Math.max(stats.mtimeMs, stats.ctimeMs) >= since - clockTolerance : previous !== signature;
  };
}

/**
 * Watches the build of a linked Meeko: `dist` recursively and the package root for its
 * `package.json` and for `dist` being removed or created again. Calls `change` once the build
 * differs from the last one reported (its files, modification times and sizes, compared after a
 * quiet period): a read, a watcher error or an event without a name that leaves it equal calls
 * nothing. The first state is read when the watch starts and no disk is touched while no event
 * arrives; the caller debounces the calls.
 *
 * `written()` answers at once whether the build differs from the last time this watch read it. A
 * burst of writes keeps extending the quiet period, so `change` says nothing until it ends: this
 * compares the files as well, so an event that wrote nothing still does not count. It leaves the
 * report to `change`, which comes when the burst ends.
 */
export function watchLinkedMeeko(linked: LinkedMeeko, change: () => void, options: WatchLinkedMeekoOptions = {}): { close(): void; written(): boolean } {
  const persistent = options.persistent ?? true;
  const watchPath = options.watch ?? watch;
  const written = createWriteFilter();
  let closed = false;
  // First, before any event: a build that starts right after this still emits events to compare.
  const initial = scanBuild(linked);
  let known = initial.digest;
  /** The last state read, reported or not. */
  let seen = initial.digest;
  /**
   * Every event that may be a write ends here, after the quiet period: the build counts as changed
   * only if its files differ from the last state, whatever event woke the watcher. The scan is one
   * synchronous pass; a write after it emits its own event and is compared again.
   */
  const verify = createSettleDebounce(options.verifyDelay ?? linkVerifyDelay, () => {
    if (closed) return;
    const current = scanBuild(linked).digest;
    seen = current;
    if (current === known) return;
    known = current;
    change();
  });
  // Written after the process loaded the build but before this watch: no event will tell.
  if (options.loadedAt !== undefined && initial.newest > options.loadedAt + clockTolerance) {
    known = "";
    verify.trigger();
  }
  let dist: FSWatcher | undefined;
  const watchDist = (): void => {
    dist?.close();
    dist = undefined;
    if (closed || !existsSync(linked.dist)) return;
    try {
      const watcher = watchPath(linked.dist, { recursive: true, persistent }, (event, name) => {
        if (event === "rename" || name === null || written(join(linked.dist, name))) verify.trigger();
      });
      // Removing the watched directory ends this watcher; the root watcher sees it come back.
      watcher.on("error", () => {
        watcher.close();
        if (dist === watcher) dist = undefined;
        verify.trigger();
      });
      dist = watcher;
    } catch {
      // Removed meanwhile, or no recursive watching on this platform.
    }
  };
  let root: FSWatcher | undefined;
  try {
    root = watchPath(linked.directory, { persistent }, (event, name) => {
      if (name === null || name === "dist") {
        // A rename is `dist` removed or created again. A change is its contents on some
        // platforms, which the `dist` watcher already reports, or `dist` being listed.
        if (event === "rename" || !dist) {
          watchDist();
          verify.trigger();
        }
      } else if (name === "package.json" && (event === "rename" || written(join(linked.directory, name)))) {
        verify.trigger();
      }
    });
    root.on("error", () => { root?.close(); root = undefined; });
  } catch {
    // The checkout cannot be watched: only `dist` is.
  }
  watchDist();
  return {
    written() {
      const current = scanBuild(linked).digest;
      const differs = current !== seen;
      seen = current;
      return differs;
    },
    close() {
      closed = true;
      verify.cancel();
      root?.close();
      dist?.close();
    },
  };
}

function isMessage(value: unknown, type: string): boolean {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === type;
}

/** Options of {@link superviseDevelopment}; the defaults suit a `tsc` build. */
export interface SuperviseOptions {
  /** Quiet time after the last change before restarting. */
  delay?: number;
  /** Time a server has to close before it is killed. */
  stopTimeout?: number;
  /** The other linked packages, see {@link findLinkedPackages}. Their builds do not restart a healthy server. */
  related?: readonly LinkedMeeko[];
  /** Replaces `fs.watch`; for tests that inject events the platform does not produce on demand. */
  watch?: typeof watch;
}

/** Starts of a failed server, each after twice the wait of the last, before waiting for the next change. */
const maxLinkRetries = 6;
/** Longest wait between those starts. */
const maxLinkRetryDelay = 10_000;

/**
 * Runs `meeko dev` in a child process and starts a fresh one each time the linked Meeko is
 * rebuilt: the Meeko runtime stays cached in the module graph of the Node process that loaded
 * it, so only a new process loads the new build. The child gets the same command line, working
 * directory, environment and standard streams; it closes its server (sockets, Vite, the editor
 * bridge descriptor) before the next one listens on the same port.
 *
 * A pending restart also waits for the `related` packages to settle. A child that fails after some
 * linked package was written since it started read a build halfway, also when the watch has not
 * reported that write yet: it starts again, waiting twice as long each time and never while they
 * are still being written. One that fails with nothing written, whatever events the watch received,
 * is a real failure: the first child behaves as an unsupervised `meeko dev`, and the
 * supervisor exits with its code; a later one is reported and starts again on the next change of
 * any linked package. SIGINT and SIGTERM stop the child and then the supervisor; a second signal
 * kills it. Resolves to the exit code.
 */
export async function superviseDevelopment(linked: LinkedMeeko, options: SuperviseOptions = {}): Promise<number> {
  const delay = options.delay ?? linkSettleDelay;
  const stopTimeout = options.stopTimeout ?? 10_000;
  const related = options.related ?? [];
  const args = [...process.execArgv, process.argv[1]!, ...process.argv.slice(2)];
  let child: ChildProcess | undefined;
  /** When a linked package was last written, and when the current child started. */
  let lastWrite = 0;
  let launchedAt = 0;
  /** Starts since the last server that listened, for the wait before the next one. */
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
  };
  /** Ports of the first server that listened, kept by the next ones. */
  const pinned: Record<string, string> = {};
  let generation = 0;
  let stopping = false;
  let restarting = false;
  let queued = false;
  let finish!: (code: number) => void;
  const finished = new Promise<number>((done) => { finish = done; });

  const launch = (): void => {
    generation++;
    const first = generation === 1;
    let ready = false;
    launchedAt = Date.now();
    const current = spawn(process.execPath, args, {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env: { ...process.env, ...pinned, [supervisedDevelopmentEnv]: "1" },
      windowsHide: true,
    });
    child = current;
    current.on("message", (message) => {
      if (!isMessage(message, readyMessage)) return;
      ready = true;
      retries = 0;
      const { port, hmrPort } = message as { port?: unknown; hmrPort?: unknown };
      if (pinned[supervisedPortEnv] === undefined && Number.isInteger(port) && Number.isInteger(hmrPort)) {
        pinned[supervisedPortEnv] = String(port);
        pinned[supervisedHmrPortEnv] = String(hmrPort);
      }
    });
    const ended = (code: number): void => {
      // A child this supervisor stopped is handled where it stops it.
      if (current !== child) return;
      child = undefined;
      if (stopping) finish(code);
      else if (debounce.pending || restarting) return;
      else if (code !== 0 && writtenSinceLaunch() && retries < maxLinkRetries) scheduleRetry(code);
      else if (first) finish(code);
      else {
        process.stderr.write(`[meeko] meeko dev ${ready ? "terminó" : "no pudo arrancar"} con el Meeko enlazado (código ${code}); `
          + `se reiniciará con el próximo cambio de ${[linked, ...related].map((item) => item.dist).join(", ")}\n`);
      }
    };
    current.once("error", (error) => {
      process.stderr.write(`[meeko] no se pudo iniciar meeko dev: ${error.message}\n`);
      ended(1);
    });
    current.once("exit", (code, signal) => ended(code ?? (signal ? 1 : 0)));
  };

  /** Asks the current child to close its server and waits for it, killing it after `stopTimeout`. */
  const stopCurrent = async (): Promise<number> => {
    const current = child;
    child = undefined;
    if (!current || current.exitCode !== null || current.signalCode !== null) return current?.exitCode ?? 0;
    const exited = new Promise<number>((done) => {
      current.once("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
      // A child that never started has nothing to wait for.
      current.once("error", () => done(1));
    });
    const kill = (): void => { current.kill("SIGKILL"); };
    if (current.connected) current.send({ type: stopMessage }, (error) => { if (error) kill(); });
    else kill();
    const timer = setTimeout(kill, stopTimeout);
    try { return await exited; }
    finally { clearTimeout(timer); }
  };

  /**
   * Brings `lastWrite` up to date with the disk. A burst of writes is reported when it ends, so the
   * watchers cannot tell yet; the files can, and a read that only woke them leaves those equal.
   */
  const noteWrites = (): void => {
    if ([watcher, ...relatedWatchers].filter((item) => item.written()).length) lastWrite = Date.now();
  };
  const writtenSinceLaunch = (): boolean => {
    noteWrites();
    return lastWrite >= launchedAt;
  };

  /** Starts a child that read a build halfway again, once the linked packages have been quiet for `delay`. */
  const scheduleRetry = (code: number): void => {
    const wait = Math.min(delay * 2 ** retries, maxLinkRetryDelay);
    retries++;
    process.stderr.write(`[meeko] meeko dev no pudo arrancar mientras se escribía un paquete enlazado (código ${code}); reintento ${retries} de ${maxLinkRetries} en ${wait} ms\n`);
    const attempt = (): void => {
      noteWrites();
      // A build of Meeko that settled restarts the server by itself.
      if (debounce.pending) {
        retryTimer = undefined;
        return;
      }
      const quiet = Date.now() - lastWrite;
      retryTimer = quiet < delay ? setTimeout(attempt, delay - quiet) : undefined;
      if (!retryTimer) void restart();
    };
    retryTimer = setTimeout(attempt, wait);
  };

  const restart = async (): Promise<void> => {
    if (stopping) return;
    cancelRetry();
    if (restarting) { queued = true; return; }
    restarting = true;
    try {
      do {
        queued = false;
        process.stdout.write("[meeko] Meeko enlazado cambió; reiniciando meeko dev…\n");
        await stopCurrent();
        if (stopping) return;
        launch();
      } while (queued && !stopping);
    } finally {
      restarting = false;
    }
  };
  const debounce = createSettleDebounce(delay, () => { void restart(); });
  const watcher = watchLinkedMeeko(linked, () => {
    if (stopping) return;
    lastWrite = Date.now();
    debounce.trigger();
  }, options.watch ? { watch: options.watch } : {});
  // A build of another package extends a pending restart and revives a server that failed, but
  // leaves a healthy one running: Vite follows those files.
  const relatedWatchers = related.map((item) => watchLinkedMeeko(item, () => {
    if (stopping) return;
    lastWrite = Date.now();
    if (debounce.pending || (!child && !restarting && !retryTimer)) debounce.trigger();
  }, options.watch ? { watch: options.watch } : {}));

  const stop = (): void => {
    if (stopping) {
      // A second Ctrl+C does not wait for the server to close.
      child?.kill("SIGKILL");
      finish(1);
      return;
    }
    stopping = true;
    debounce.cancel();
    cancelRetry();
    if (!child) { finish(0); return; }
    void stopCurrent().then(finish);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  launch();
  try {
    return await finished;
  } finally {
    stopping = true;
    debounce.cancel();
    cancelRetry();
    watcher.close();
    for (const relatedWatcher of relatedWatchers) relatedWatcher.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

/**
 * Warns on every rebuild of the linked Meeko that an unsupervised `meeko dev` (with
 * `MEEKO_LINK_WATCH=0`) keeps running. The server loads `@meekojs/meeko` with Node, outside
 * Vite's module runner, and Node keeps those modules for the life of the process: the server side
 * stays on the build this process loaded while Vite serves the browser the new files of `dist`,
 * so pages render with the old code and hydrate with the new one until the server is restarted.
 * One line per build, once it settles, and only if the files of the build changed; a build written
 * after this process started but before the watch is reported once. The watchers do not keep the
 * process alive; `watchOptions` adjusts them.
 */
export function warnLinkedMeekoRebuilds(
  linked: LinkedMeeko,
  write: (text: string) => void = (text) => { process.stderr.write(text); },
  delay = linkSettleDelay,
  watchOptions: WatchLinkedMeekoOptions = {},
): { close(): void } {
  // A `MEEKO_DEV_SUPERVISED=1` inherited without a supervisor also leaves the server alone.
  const reason = process.env[linkWatchEnv] === "0" ? `${linkWatchEnv}=0` : `${supervisedDevelopmentEnv}=1 sin supervisor`;
  const debounce = createSettleDebounce(delay, () => {
    write(`[meeko] Meeko enlazado cambió (${linked.dist}), pero este meeko dev no se reinicia solo (${reason}): `
      + "el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.\n");
  });
  const watcher = watchLinkedMeeko(linked, () => debounce.trigger(), { loadedAt: Date.now() - process.uptime() * 1000, ...watchOptions, persistent: false });
  return {
    close() {
      debounce.cancel();
      watcher.close();
    },
  };
}

/** Whether this process is the `meeko dev` that {@link superviseDevelopment} started. */
export function isSupervisedDevelopment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[supervisedDevelopmentEnv] === "1" && typeof process.send === "function";
}

/**
 * Runs the development server under a supervisor: reports when it listens, with its `ports`, and
 * closes it, then exits, when the supervisor asks to (before a restart or on Ctrl+C), when the
 * supervisor disappears (killed without a chance to stop this process) or on SIGINT and SIGTERM.
 * A server that takes longer than `stopTimeout` to close is abandoned: exiting frees its port anyway.
 */
export async function runSupervisedDevelopment<T>(
  start: () => Promise<T>,
  close: (server: T) => Promise<void>,
  ports: (server: T) => { readonly port: number; readonly hmrPort: number } | undefined = () => undefined,
  stopTimeout = 5_000,
): Promise<void> {
  let server: { readonly value: T } | undefined;
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    // Before it listens nothing is published; exit handlers remove anything written.
    if (!server) process.exit(0);
    setTimeout(() => process.exit(0), stopTimeout);
    void close(server.value).catch(() => undefined).finally(() => process.exit(0));
  };
  const onMessage = (message: unknown): void => { if (isMessage(message, stopMessage)) stop(); };
  process.on("message", onMessage);
  process.once("disconnect", stop);
  try {
    server = { value: await start() };
  } catch (error) {
    // The open channel would keep this process alive after the error is reported.
    process.off("message", onMessage);
    process.off("disconnect", stop);
    process.disconnect?.();
    throw error;
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.send?.({ type: readyMessage, ...ports(server.value) });
}
