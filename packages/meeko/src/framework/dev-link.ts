import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import type { FSWatcher, Stats } from "node:fs";
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

/** Options of {@link watchLinkedMeeko}. */
export interface WatchLinkedMeekoOptions {
  /** Whether the watchers keep the process alive, as `fs.watch`'s option; `true` by default. */
  persistent?: boolean;
}

/**
 * Tells writes from reads among the `change` events of the files of a linked Meeko. Windows
 * reports a read as a `change` when it updates the file's last access time (at most once an hour
 * per file, while that update is on, its default on many systems): a server loading `dist`, or
 * Vite serving one of its modules, would restart the server it belongs to. A file whose
 * modification or change time, or size, differs from the last event's changed; the first event of
 * a file counts when those times are not older than the watch.
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
    return previous === undefined ? Math.max(stats.mtimeMs, stats.ctimeMs) >= since : previous !== signature;
  };
}

/**
 * Watches the build of a linked Meeko: `dist` recursively and the package root for its
 * `package.json` and for `dist` being removed or created again. Calls `change` for every
 * event that writes, creates or removes a file (not for one that only reads it); the caller
 * debounces them.
 */
export function watchLinkedMeeko(linked: LinkedMeeko, change: () => void, options: WatchLinkedMeekoOptions = {}): { close(): void } {
  const persistent = options.persistent ?? true;
  const written = createWriteFilter();
  let closed = false;
  let dist: FSWatcher | undefined;
  const watchDist = (): void => {
    dist?.close();
    dist = undefined;
    if (closed || !existsSync(linked.dist)) return;
    try {
      const watcher = watch(linked.dist, { recursive: true, persistent }, (event, name) => {
        if (event === "rename" || name === null || written(join(linked.dist, name))) change();
      });
      // Removing the watched directory ends this watcher; the root watcher sees it come back.
      watcher.on("error", () => {
        watcher.close();
        if (dist === watcher) dist = undefined;
        change();
      });
      dist = watcher;
    } catch {
      // Removed meanwhile, or no recursive watching on this platform.
    }
  };
  let root: FSWatcher | undefined;
  try {
    root = watch(linked.directory, { persistent }, (event, name) => {
      if (name === null || name === "dist") {
        // A rename is `dist` removed or created again. A change is its contents on some
        // platforms, which the `dist` watcher already reports, or `dist` being listed.
        if (event === "rename" || !dist) {
          watchDist();
          change();
        }
      } else if (name === "package.json" && (event === "rename" || written(join(linked.directory, name)))) {
        change();
      }
    });
    root.on("error", () => { root?.close(); root = undefined; });
  } catch {
    // The checkout cannot be watched: only `dist` is.
  }
  watchDist();
  return {
    close() {
      closed = true;
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
}

/**
 * Runs `meeko dev` in a child process and starts a fresh one each time the linked Meeko is
 * rebuilt: the Meeko runtime stays cached in the module graph of the Node process that loaded
 * it, so only a new process loads the new build. The child gets the same command line, working
 * directory, environment and standard streams; it closes its server (sockets, Vite, the editor
 * bridge descriptor) before the next one listens on the same port.
 *
 * The first child behaves as an unsupervised `meeko dev`: if it exits on its own, the supervisor
 * exits with its code. After a restart a child that fails (a build caught halfway) is reported and
 * started again on the next change. SIGINT and SIGTERM stop the child and then the supervisor;
 * a second signal kills it. Resolves to the exit code.
 */
export async function superviseDevelopment(linked: LinkedMeeko, options: SuperviseOptions = {}): Promise<number> {
  const delay = options.delay ?? linkSettleDelay;
  const stopTimeout = options.stopTimeout ?? 10_000;
  const args = [...process.execArgv, process.argv[1]!, ...process.argv.slice(2)];
  let child: ChildProcess | undefined;
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
    const current = spawn(process.execPath, args, {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env: { ...process.env, ...pinned, [supervisedDevelopmentEnv]: "1" },
      windowsHide: true,
    });
    child = current;
    current.on("message", (message) => {
      if (!isMessage(message, readyMessage)) return;
      ready = true;
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
      else if (first) finish(code);
      else {
        process.stderr.write(`[meeko] meeko dev ${ready ? "terminó" : "no pudo arrancar"} con el Meeko enlazado (código ${code}); `
          + `se reiniciará con el próximo cambio de ${linked.dist}\n`);
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

  const restart = async (): Promise<void> => {
    if (stopping) return;
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
  const watcher = watchLinkedMeeko(linked, () => { if (!stopping) debounce.trigger(); });

  const stop = (): void => {
    if (stopping) {
      // A second Ctrl+C does not wait for the server to close.
      child?.kill("SIGKILL");
      finish(1);
      return;
    }
    stopping = true;
    debounce.cancel();
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
    watcher.close();
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
 * One line per build, once it settles. The watchers do not keep the process alive.
 */
export function warnLinkedMeekoRebuilds(
  linked: LinkedMeeko,
  write: (text: string) => void = (text) => { process.stderr.write(text); },
  delay = linkSettleDelay,
): { close(): void } {
  // A `MEEKO_DEV_SUPERVISED=1` inherited without a supervisor also leaves the server alone.
  const reason = process.env[linkWatchEnv] === "0" ? `${linkWatchEnv}=0` : `${supervisedDevelopmentEnv}=1 sin supervisor`;
  const debounce = createSettleDebounce(delay, () => {
    write(`[meeko] Meeko enlazado cambió (${linked.dist}), pero este meeko dev no se reinicia solo (${reason}): `
      + "el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.\n");
  });
  const watcher = watchLinkedMeeko(linked, () => debounce.trigger(), { persistent: false });
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
