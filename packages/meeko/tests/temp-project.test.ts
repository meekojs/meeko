import assert from "node:assert/strict";
import { lstat, readlink, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { createTempProject, repositoryRoot, tempProjectsRoot } from "./helpers/temp-project.ts";

// pnpm links the dependencies with relative symlinks where Windows lets it create them (an
// elevated CI runner). Reached through a link to the `node_modules` that holds them they do not
// resolve, and TypeScript 7 missed `@types/node`: each dependency gets a link of its own instead.
test("temporary projects link each repository dependency to its real directory", async () => {
  const project = await createTempProject("dependency-links");
  try {
    const modules = join(tempProjectsRoot, "node_modules");
    assert.equal((await lstat(modules)).isSymbolicLink(), false, "node_modules is a folder, not a link to the repository's");
    for (const name of ["@types/node", "@typescript/typescript6", "typescript", "vite"]) {
      const link = join(modules, ...name.split("/"));
      assert.ok((await lstat(link)).isSymbolicLink(), name);
      assert.equal(resolve(await readlink(link)), await realpath(join(repositoryRoot, "node_modules", ...name.split("/"))), name);
    }
  } finally {
    await project.remove();
  }
});
