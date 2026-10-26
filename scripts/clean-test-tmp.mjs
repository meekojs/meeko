// Deletes `.meeko/tmp`, where tests create their temporary projects, so an
// interrupted run cannot leave thousands of files under the repository. Only
// that directory is touched; a link in its place is removed without following it.
import { lstat, rm, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(repository, ".meeko", "tmp");

const status = (path) => lstat(path).catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
// A linked `.meeko` points outside the repository; leave whatever it holds alone.
const parent = await status(dirname(target));
const stats = parent && !parent.isSymbolicLink() ? await status(target) : undefined;
if (stats?.isSymbolicLink()) await unlink(target);
else if (stats) await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
