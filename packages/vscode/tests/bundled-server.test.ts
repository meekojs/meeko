import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");

/** Sends `initialize` over stdio and resolves with its result. */
function initialize(server: string): Promise<{ serverInfo?: { name?: string }; capabilities?: Record<string, unknown> }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [server, "--stdio"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = Buffer.alloc(0);
    let errors = "";
    const timer = setTimeout(() => { child.kill(); fail(new Error(`No answer to initialize: ${errors}`)); }, 30_000);
    child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
    child.once("exit", (code) => { clearTimeout(timer); fail(new Error(`The server exited with ${code}: ${errors}`)); });
    child.stdout.on("data", (chunk: Buffer) => {
      output = Buffer.concat([output, chunk]);
      const header = output.indexOf("\r\n\r\n");
      const length = Number(/Content-Length: (\d+)/i.exec(output.subarray(0, Math.max(header, 0)).toString())?.[1]);
      if (header < 0 || output.length < header + 4 + length) return;
      clearTimeout(timer);
      child.removeAllListeners("exit");
      child.kill();
      done((JSON.parse(output.subarray(header + 4, header + 4 + length).toString()) as { result: never }).result);
    });
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {} } });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  });
}

test("the language server bundled in the VSIX starts and answers initialize", { timeout: 120_000 }, async () => {
  // The bundle is what the VSIX ships when the workspace has no @meekojs/meeko; it once failed to
  // load because two bundled modules declared `createRequire` at the top level.
  execFileSync(process.execPath, [join(root, "build.mjs")], { cwd: root, stdio: "pipe", windowsHide: true });
  const result = await initialize(join(root, "dist", "server.js"));
  assert.equal(result.serverInfo?.name, "meeko-language-server");
  assert.ok(result.capabilities?.["completionProvider"]);
});
