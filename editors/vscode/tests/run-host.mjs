import { join } from "node:path";
import { runTests } from "@vscode/test-electron";

const executable = process.env.MEEKO_HOST_VSCODE;
const extension = process.env.MEEKO_HOST_EXTENSION;
const consumer = process.env.MEEKO_HOST_CONSUMER;
const data = process.env.MEEKO_HOST_DATA;
if (!executable || !extension || !consumer || !data) {
  throw new Error("Faltan MEEKO_HOST_VSCODE, MEEKO_HOST_EXTENSION, MEEKO_HOST_CONSUMER o MEEKO_HOST_DATA.");
}

await runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: extension,
  extensionTestsPath: join(import.meta.dirname, "host.cjs"),
  launchArgs: [consumer, "--skip-welcome", "--disable-extensions", "--disable-workspace-trust", "--user-data-dir", data],
});
