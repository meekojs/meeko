import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const data = await mkdtemp(join(tmpdir(), "meeko-virtual-host-"));
const workspace = join(data, "workspace");
try {
  await mkdir(workspace);
  await runTests({
    ...(process.env.MEEKO_HOST_VSCODE ? { vscodeExecutablePath: process.env.MEEKO_HOST_VSCODE } : { version: "stable" }),
    extensionDevelopmentPath: resolve(import.meta.dirname, ".."),
    extensionTestsPath: join(import.meta.dirname, "host-virtual-index.cjs"),
    launchArgs: [workspace, "--skip-welcome", "--disable-extensions", "--disable-workspace-trust", "--user-data-dir", join(data, "user-data")],
  });
} finally {
  if (!resolve(data).startsWith(resolve(tmpdir(), "meeko-virtual-host-"))) throw new Error("Unexpected test directory");
  await rm(data, { recursive: true, force: true });
}
