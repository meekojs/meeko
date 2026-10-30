import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const typescriptPackage = require.resolve("typescript/package.json");
const launcher = join(dirname(typescriptPackage), "bin", "tsc");

/**
 * The native `tsc.exe` on Windows. The JS launcher spawns it without `windowsHide`, so running
 * the launcher from the language server flashes a console window on every check.
 */
const nativeTsc = process.platform === "win32"
  ? join(dirname(createRequire(typescriptPackage).resolve(`@typescript/typescript-win32-${process.arch}/package.json`)), "lib", "tsc.exe")
  : undefined;

/** `\\?\` lifts the 260-character limit of a Windows path. */
const nativeExecutable = nativeTsc && nativeTsc.length >= 248 ? `\\\\?\\${nativeTsc}` : nativeTsc;

/**
 * The command that runs the TypeScript compiler with `args`, without an intermediate process:
 * `tsc.exe` directly on Windows, the launcher through the current Node elsewhere. Spawn it with
 * `windowsHide: true`.
 */
export function tscCommand(args: readonly string[]): { readonly file: string; readonly args: readonly string[] } {
  return nativeExecutable ? { file: nativeExecutable, args } : { file: process.execPath, args: [launcher, ...args] };
}
