import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tooling = /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:typescript|@typescript\/typescript6|parse5|postcss|ws)\//;

async function entry(subpath: string): Promise<string> {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { exports: Record<string, { default: string }> };
  const target = manifest.exports[subpath]?.default;
  assert.ok(target, `package.json does not export ${subpath}`);
  return resolve(target);
}

test("the portable ./server entry bundles for a neutral platform with only node:async_hooks external", async () => {
  const result = await build({
    entryPoints: [await entry("./server")],
    bundle: true, format: "esm", platform: "neutral", write: false, metafile: true, outdir: "out",
    external: ["node:*"], logLevel: "silent",
  });
  const output = Object.values(result.metafile.outputs)[0];
  assert.ok(output);
  const external = [...new Set(output.imports.filter((item) => item.external).map((item) => item.path))].sort();
  assert.deepEqual(external, ["node:async_hooks"]);
  const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll("\\", "/"));
  assert.ok(!inputs.some((input) => tooling.test(input)), inputs.join("\n"));
  assert.ok(!inputs.some((input) => /\/dist\/(?:node|build|compiler|vite)\.js$|\/dist\/framework\/(?:config|routes-discovery|prerender|project)\.js$/.test(input)), inputs.join("\n"));
});

test("the ./node adapter keeps build tooling and TypeScript out of the server process", async () => {
  const result = await build({
    entryPoints: [await entry("./node")],
    bundle: true, format: "esm", platform: "node", write: false, metafile: true, outdir: "out",
    packages: "bundle", external: ["ws"], logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll("\\", "/"));
  assert.ok(!inputs.some((input) => tooling.test(input)), inputs.join("\n"));
  assert.ok(!inputs.some((input) => /\/dist\/framework\/(?:config|routes-discovery|prerender|project)\.js$/.test(input)), inputs.join("\n"));
});

test("the ./bun, ./deno and ./cloudflare adapters bundle for a neutral platform without ws, the Node adapter or build tooling", async () => {
  for (const subpath of ["./bun", "./deno", "./cloudflare"]) {
    const result = await build({
      entryPoints: [await entry(subpath)],
      bundle: true, format: "esm", platform: "neutral", write: false, metafile: true, outdir: "out",
      external: ["node:*"], logLevel: "silent",
    });
    const output = Object.values(result.metafile.outputs)[0];
    assert.ok(output);
    const external = [...new Set(output.imports.filter((item) => item.external).map((item) => item.path))].sort();
    // Like ./server, at most node:async_hooks may stay external; Bun, Deno and workerd (nodejs_als) provide it.
    assert.ok(external.every((path) => path === "node:async_hooks"), `${subpath}: ${external.join(", ")}`);
    const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll("\\", "/"));
    assert.ok(!inputs.some((input) => tooling.test(input)), `${subpath}\n${inputs.join("\n")}`);
    assert.ok(!inputs.some((input) => /\/dist\/(?:node|build|compiler|vite)\.js$|\/dist\/framework-server\/node-[^/]+\.js$|\/dist\/framework\/(?:config|routes-discovery|prerender|project)\.js$/.test(input)), `${subpath}\n${inputs.join("\n")}`);
  }
});

test("server, node, bun, deno, cloudflare and build subpaths expose exactly their documented runtime values", async () => {
  const server = await import(pathToFileURL(await entry("./server")).href);
  assert.deepEqual(Object.keys(server).sort(), [
    "ApiError", "LocalSocketPubSub", "MemorySessionStore", "RedisSessionStore", "RedisSocketPubSub", "SessionHandle", "SessionManager",
    "SessionRevokedError", "SessionSecurityError", "SqlSessionStore", "composeServerMiddleware", "createFrameworkHandler", "createLocalCalls",
    "createLocalServerFetch", "createRequestContext", "createServerApp", "createServerClientOptions", "createServerDispatcher",
    "createSocketHub", "createSocketUpgradeHandler", "defineApiRoute", "defineRpc", "defineServerMiddleware", "defineServerRuntime", "defineSocketChannel",
    "dispatchApiRoute", "dispatchRpc", "errorResponse", "executeApiRoute", "executeRpc", "generateOpenApi",
    "loadSocketChannels", "openSocketSession", "useRequestState",
  ]);
  const node = await import(pathToFileURL(await entry("./node")).href);
  assert.deepEqual(Object.keys(node).sort(), [
    "attachNodeWebSocketServer", "createNodeAssetReader", "createNodeSocketUpgradeHandler", "serveNode", "toNodeListener",
  ]);
  // Both adapters reach Bun and Deno globals only when called, so Node can import them.
  const bun = await import(pathToFileURL(await entry("./bun")).href);
  assert.deepEqual(Object.keys(bun).sort(), ["createBunAssetReader", "createBunServer"]);
  const deno = await import(pathToFileURL(await entry("./deno")).href);
  assert.deepEqual(Object.keys(deno).sort(), ["createDenoAssetReader", "serveDeno"]);
  // The Workers adapter takes DurableObject as an argument instead of importing cloudflare:workers.
  const cloudflare = await import(pathToFileURL(await entry("./cloudflare")).href);
  assert.deepEqual(Object.keys(cloudflare).sort(), [
    "D1SessionDriver", "DurableObjectSocketPubSub", "createCloudflareAssetReader", "createCloudflarePrerenderSource",
    "createSocketRoomClass", "createWorker", "socketRoomName",
  ]);
  const tools = await import(pathToFileURL(await entry("./build")).href);
  assert.deepEqual(Object.keys(tools).sort(), [
    "buildProject", "composeFrameworkRoutes", "discoverConfiguredRoutes", "discoverRoutes", "discoverServerManifest",
    "loadMeekoConfig", "prerenderProject", "prerenderRoutes", "readMeekoConfigSync", "resolveConfigSources",
  ]);
});
