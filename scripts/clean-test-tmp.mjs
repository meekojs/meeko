// Deletes the directory where tests create their temporary projects (see
// scripts/test-tmp-root.mjs), so an interrupted run cannot leave thousands of files
// behind. It also deletes `.meeko/tmp`, where tests/fullstack-consumer.ps1 runs and
// where earlier versions of the tests created their projects. Only those directories
// are touched; a link in their place is removed without following it, and so are the
// links inside them (each project links the repository and its dependencies).
import { lstat, rm, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testTempRoot } from "./test-tmp-root.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const status = (path) => lstat(path).catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});

async function clean(target) {
  // A linked parent points elsewhere; leave whatever it holds alone.
  const parent = await status(dirname(target));
  const stats = parent && !parent.isSymbolicLink() ? await status(target) : undefined;
  if (stats?.isSymbolicLink()) await unlink(target);
  else if (stats) await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

await clean(testTempRoot(repository));
await clean(join(repository, ".meeko", "tmp"));
