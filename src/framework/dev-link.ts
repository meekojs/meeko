import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
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

/**
 * Watches the build of a linked Meeko: `dist` recursively and the package root for its
 * `package.json` and for `dist` being removed or created again. Calls `change` for every
 * event; the caller debounces them.
 */
export function watchLinkedMeeko(linked: LinkedMeeko, change: () => void): { close(): void } {
  let closed = false;
  let dist: FSWatcher | undefined;
  const watchDist = (): void => {
    dist?.close();
    dist = undefined;
    if (closed || !existsSync(linked.dist)) return;
    try {
      const watcher = watch(linked.dist, { recursive: true }, () => change());
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
    root = watch(linked.directory, (event, name) => {
      if (name === null || name === "dist") {
        // A rename is `dist` removed or created again; a change, its contents on some platforms.
        if (event === "rename" || !dist) watchDist();
        change();
      } else if (name === "package.json") {
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
