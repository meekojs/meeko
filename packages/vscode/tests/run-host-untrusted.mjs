import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "meeko-untrusted-host-"));
const workspace = join(root, "workspace");
const userData = join(root, "user-data");
const packageRoot = join(workspace, "node_modules", "@meekojs", "meeko");

try {
  await mkdir(join(packageRoot, "dist", "language-server"), { recursive: true });
  await mkdir(join(userData, "User"), { recursive: true });
  await writeFile(join(userData, "User", "settings.json"), JSON.stringify({
    "security.workspace.trust.enabled": true,
    "security.workspace.trust.startupPrompt": "never",
    "meeko.languageServer.preferWorkspace": true,
    "meeko.live.enabled": true,
  }));
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "@meekojs/meeko",
    version: "99.0.0-test",
    bin: { "meeko-language-server": "./dist/language-server/main.js" },
  }));
  await writeFile(join(packageRoot, "dist", "language-server", "main.js"), "throw new Error('Untrusted workspace server was started');\n");
  await writeFile(join(workspace, "Counter.meeko"), '<script lang="ts">const count: number = "bad";</script><template><p>{count}</p></template>');

  // @vscode/test-electron 3.1.0 always adds --disable-workspace-trust.
  // Launch the same extension test host through the public VS Code CLI instead.
  const executable = process.env.MEEKO_HOST_VSCODE ?? join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe");
  const args = [
    workspace,
    "--no-sandbox", "--disable-gpu-sandbox", "--disable-updates", "--skip-welcome", "--skip-release-notes", "--no-cached-data",
    "--disable-extensions", "--user-data-dir", userData, "--extensions-dir", join(root, "extensions"),
    `--extensionDevelopmentPath=${resolve(import.meta.dirname, "..")}`,
    `--extensionTestsPath=${join(import.meta.dirname, "host-untrusted-index.cjs")}`,
  ];
  const exitCode = await new Promise((done, reject) => {
    const child = spawn(executable, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => signal ? reject(new Error(`VS Code exited with ${signal}`)) : done(code));
  });
  if (exitCode !== 0) throw new Error(`VS Code host failed with exit code ${exitCode}`);
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir(), "meeko-untrusted-host-"))) throw new Error("Unexpected test directory");
  await rm(root, { recursive: true, force: true });
}
