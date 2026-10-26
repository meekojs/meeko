import { join } from "node:path";
import { runTests } from "@vscode/test-electron";

const executable = process.env.MEEKO_HOST_VSCODE;
const extension = process.env.MEEKO_HOST_EXTENSION;
const consumer = process.env.MEEKO_HOST_CONSUMER;
const data = process.env.MEEKO_HOST_DATA;
if (!extension || !consumer || !data) {
  throw new Error("Faltan MEEKO_HOST_EXTENSION, MEEKO_HOST_CONSUMER o MEEKO_HOST_DATA.");
}

await runTests({
  ...(executable ? { vscodeExecutablePath: executable } : { version: "stable", cachePath: join(data, "..", "vscode-download") }),
  extensionDevelopmentPath: extension,
  extensionTestsPath: join(import.meta.dirname, "host-index.cjs"),
  launchArgs: [consumer, "--skip-welcome", "--disable-extensions", "--disable-workspace-trust", "--user-data-dir", data],
});
