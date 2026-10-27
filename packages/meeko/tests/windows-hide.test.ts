import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

const source = join(import.meta.dirname, "..", "src");
/** Calls that start a child process: `spawn`, `execFile` and their promisified aliases. */
const launch = /\b(?:spawn|spawnSync|execFile|execFileSync|execFileAsync|execute|fork)\(/g;

test("every child process hides its console window on Windows", async () => {
  // The language server and Vite run without a console: a child without windowsHide opens a window.
  const missing: string[] = [];
  for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const file = join(entry.parentPath, entry.name);
    const text = await readFile(file, "utf8");
    if (!text.includes("node:child_process")) continue;
    for (const match of text.matchAll(launch)) {
      const before = text.slice(Math.max(0, match.index - 16), match.index);
      // Declarations such as `const execute = promisify(execFile)` and `function spawn(` are not launches.
      if (/(?:promisify\(|function\s+)$/.test(before) || text.slice(match.index - 1, match.index) === ".") continue;
      const call = text.slice(match.index, text.indexOf(";", match.index));
      if (!call.includes("windowsHide")) missing.push(`${relative(source, file)}: ${call.slice(0, 80)}`);
    }
  }
  assert.deepEqual(missing, []);
});
