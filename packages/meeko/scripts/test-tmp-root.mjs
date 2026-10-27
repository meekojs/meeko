// Location of the temporary projects of the tests, shared by tests/helpers/temp-project.ts and
// scripts/clean-test-tmp.mjs. It lives in the system's temporary directory, outside the
// repository: an editor with the Meeko extension open on the repository, or on a project that
// links this package, watches its workspace and would otherwise check those projects and connect
// to their `meeko dev`. The name carries a hash of the checkout path, so parallel checkouts
// (worktrees) never empty each other's projects.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Directory of the temporary test projects of the checkout at `repository`.
 * @param {string} repository
 * @returns {string}
 */
export function testTempRoot(repository) {
  const path = resolve(repository);
  const key = process.platform === "win32" ? path.toLowerCase() : path;
  return join(realpathSync.native(tmpdir()), `meeko-tests-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`);
}
