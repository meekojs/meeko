import { cp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "dist", "components");
await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });
await cp(join(root, "src", "components"), target, { recursive: true });
for (const filename of (await readdir(target)).filter((name) => name.endsWith(".meeko"))) {
  const file = join(target, filename);
  const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("@meekojs/meeko")));
  const { stdout } = await promisify(execFile)(process.execPath, [cli, "types", file], { cwd: root, windowsHide: true });
  const declaration = await readFile(stdout.trim(), "utf8");
  await writeFile(file.replace(/\.meeko$/, ".d.meeko.ts"), declaration);
}
