import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveLanguageServer } from "../src/server-resolution.js";

function workspace(manifest?: object, withServer = true): string {
  const root = mkdtempSync(join(tmpdir(), "meeko-server-resolution-"));
  const project = join(root, "app");
  mkdirSync(project, { recursive: true });
  if (manifest) {
    const meeko = join(root, "node_modules", "@meekojs", "meeko");
    mkdirSync(join(meeko, "dist", "language-server"), { recursive: true });
    writeFileSync(join(meeko, "package.json"), JSON.stringify(manifest));
    if (withServer) writeFileSync(join(meeko, "dist", "language-server", "main.js"), "");
  }
  return root;
}

test("prefers the workspace language server found in an ancestor node_modules", () => {
  const root = workspace({ version: "1.0.0", bin: { meeko: "dist/cli.js", "meeko-language-server": "dist/language-server/main.js" } });
  try {
    const resolved = resolveLanguageServer({ folders: [join(root, "app")], bundled: "bundled.js", preferWorkspace: true });
    assert.equal(resolved.source, "workspace");
    assert.equal(resolved.version, "1.0.0");
    assert.equal(resolved.module, join(root, "node_modules", "@meekojs", "meeko", "dist", "language-server", "main.js"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("falls back to the bundled server for older packages, missing files or untrusted workspaces", () => {
  const older = workspace({ version: "0.1.0", bin: { meeko: "dist/cli.js" } });
  const missing = workspace({ version: "1.0.0", bin: { "meeko-language-server": "dist/language-server/main.js" } }, false);
  const empty = workspace();
  try {
    const fromOlder = resolveLanguageServer({ folders: [join(older, "app")], bundled: "bundled.js", preferWorkspace: true });
    assert.deepEqual([fromOlder.source, fromOlder.module], ["bundled", "bundled.js"]);
    assert.match(fromOlder.reason ?? "", /0\.1\.0/);
    assert.equal(resolveLanguageServer({ folders: [join(missing, "app")], bundled: "bundled.js", preferWorkspace: true }).source, "bundled");
    assert.equal(resolveLanguageServer({ folders: [join(empty, "app")], bundled: "bundled.js", preferWorkspace: true }).source, "bundled");
    const trustedOnly = workspace({ version: "1.0.0", bin: { "meeko-language-server": "dist/language-server/main.js" } });
    try {
      const untrusted = resolveLanguageServer({ folders: [join(trustedOnly, "app")], bundled: "bundled.js", preferWorkspace: false });
      assert.equal(untrusted.source, "bundled");
    } finally { rmSync(trustedOnly, { recursive: true, force: true }); }
  } finally {
    for (const root of [older, missing, empty]) rmSync(root, { recursive: true, force: true });
  }
});
