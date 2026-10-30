import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tscCommand } from "../src/typescript-cli.js";

const source = fileURLToPath(new URL("../src/", import.meta.url));

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? files(join(directory, entry.name))
    : Promise.resolve(entry.name.endsWith(".ts") ? [join(directory, entry.name)] : [])));
  return nested.flat();
}

test("only typescript-cli.ts reaches the tsc launcher, which flashes a console window on Windows", async () => {
  const offenders: string[] = [];
  for (const file of await files(source)) {
    if (file.endsWith("typescript-cli.ts")) continue;
    const text = await readFile(file, "utf8");
    if (/"bin",\s*"tsc"|bin\/tsc\b/.test(text)) offenders.push(relative(source, file));
  }
  assert.deepEqual(offenders, []);
});

test("tscCommand runs tsc.exe directly on Windows and the launcher through Node elsewhere", () => {
  const command = tscCommand(["--noEmit"]);
  if (process.platform === "win32") {
    assert.match(command.file, /tsc\.exe$/);
    assert.deepEqual(command.args, ["--noEmit"]);
  } else {
    assert.equal(command.file, process.execPath);
    assert.match(command.args[0]!, /bin[\\/]tsc$/);
    assert.deepEqual(command.args.slice(1), ["--noEmit"]);
  }
});
