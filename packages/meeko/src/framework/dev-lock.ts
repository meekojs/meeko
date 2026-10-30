import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DevelopmentServerRecord } from "../devtools-bridge-protocol.js";

/** The process of `meeko dev` that serves a project, under its `.meeko/dev/`. */
export const developmentLockFile = join(".meeko", "dev", "server.json");

type DevelopmentLock = Readonly<DevelopmentServerRecord>;

/** Records this process already removes when it exits. */
const claimed = new Set<string>();

/** Whether a process with `pid` is running; `EPERM` means it runs as another user. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(file: string): DevelopmentLock | undefined {
  try {
    const lock = JSON.parse(readFileSync(file, "utf8")) as Partial<DevelopmentLock>;
    return typeof lock.pid === "number" && Number.isInteger(lock.pid) && lock.pid > 0 ? lock as DevelopmentLock : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records this process as the `meeko dev` of `projectRoot` and warns when another one that is still
 * running already serves it: both rewrite `.meeko/`, so each start reloads the other's SSR entries.
 * It only warns, because two servers of one project can be intended. The record stays the first
 * one's and leaves with its process; one left by a killed process names a process that no longer
 * runs and is replaced.
 */
export function claimDevelopmentProject(projectRoot: string, warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`)): void {
  const file = resolve(projectRoot, developmentLockFile);
  const other = readLock(file);
  if (other && other.pid !== process.pid && isRunning(other.pid)) {
    warn(`[meeko] Otro meeko dev (PID ${other.pid}) ya sirve este proyecto: los dos reescriben .meeko/ y cada arranque recarga las entradas del otro. Detenga uno de los dos.`);
    // The record stays the first one's: a later start still warns, and this one leaving does not erase it.
    return;
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() } satisfies DevelopmentLock)}\n`, "utf8");
  } catch {
    // Without the record a later dev cannot warn; serving does not depend on it.
    return;
  }
  if (claimed.has(file)) return;
  claimed.add(file);
  process.once("exit", () => {
    if (readLock(file)?.pid !== process.pid) return;
    try { rmSync(file, { force: true }); } catch { /* The process is leaving anyway. */ }
  });
}

/**
 * Notes in this process's record that it publishes no live values for the editor, and `reason`, so
 * the editor can say so instead of waiting for a descriptor. Only this process's own record changes:
 * a second dev of the project, which does not hold it, leaves the first one's alone.
 */
export function recordEditorBridgeOff(projectRoot: string, reason: string): void {
  const file = resolve(projectRoot, developmentLockFile);
  const lock = readLock(file);
  if (lock?.pid !== process.pid) return;
  try {
    writeFileSync(file, `${JSON.stringify({ ...lock, editorBridge: false, editorBridgeReason: reason } satisfies DevelopmentServerRecord)}\n`, "utf8");
  } catch {
    // The editor then shows the bridge as disconnected; serving does not depend on it.
  }
}
