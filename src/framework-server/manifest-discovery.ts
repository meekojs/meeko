import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { assertCallablePaths, clientKey, collisionKey, parts } from "./discovery.js";
import type { ApiEndpoint, ApiMethod, RpcEndpoint, ServerManifest, SocketEndpoint } from "./discovery.js";

async function files(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(file));
    else if (entry.isFile() && /\.(?:ts|js|mts|mjs)$/.test(entry.name) && !/\.(?:test|spec|d)\.(?:ts|js|mts|mjs)$/.test(entry.name)) found.push(file);
  }
  return found.sort();
}

function rel(root: string, file: string): string {
  return relative(root, file).split(sep).join("/").replace(/\.(?:ts|js|mts|mjs)$/, "");
}

function apiEndpoint(directory: string, file: string): ApiEndpoint {
  const path = rel(directory, file);
  const match = /^(.*)\.(get|post|put|patch|delete)$/.exec(path);
  if (!match) throw new Error(`API handler requires a method suffix: ${file}`);
  const route = match[1]!.split("/");
  if (route.at(-1) === "index") route.pop();
  if (route.length === 0) throw new Error(`API handler cannot target /api because it has no generated client key: ${file}`);
  const pathname = `/api${route.length ? `/${route.join("/")}` : ""}`;
  parts(pathname);
  return { kind: "api", file, pathname, method: match[2]!.toUpperCase() as ApiMethod, clientKey: clientKey(pathname.slice(4)) };
}

function rpcEndpoint(directory: string, file: string): RpcEndpoint {
  const path = rel(directory, file);
  const route = path.split("/");
  if (route.some((part) => !/^[A-Za-z_$][\w$]*$/.test(part))) throw new Error(`Invalid RPC procedure name: ${file}`);
  const id = route.join(".");
  return { kind: "rpc", file, id, pathname: `/_meeko/rpc/${route.join("/")}` };
}

/** Static discovery for build tooling and development; no handler is executed here. */
export async function discoverServerManifest(projectRoot: string): Promise<ServerManifest> {
  const root = resolve(projectRoot);
  const apiRoot = join(root, "server", "api");
  const rpcRoot = join(root, "server", "rpc");
  const socketRoot = join(root, "server", "socket");
  const api = (await files(apiRoot)).map((file) => apiEndpoint(apiRoot, file));
  const rpc = (await files(rpcRoot)).map((file) => rpcEndpoint(rpcRoot, file));
  const socket = (await files(socketRoot)).map((file): SocketEndpoint => {
    const name = rel(socketRoot, file);
    if (!/^[A-Za-z_$][\w$-]*$/.test(name)) throw new Error(`Invalid Socket channel name in ${file}; use a single named file`);
    return { kind: "socket", file, name, pathname: `/_meeko/socket/${name}` };
  });
  const socketNames = new Map<string, string>();
  for (const endpoint of socket) {
    const previous = socketNames.get(endpoint.name);
    if (previous) throw new Error(`Socket channel collision: ${previous} and ${endpoint.file} both resolve to ${endpoint.name}`);
    socketNames.set(endpoint.name, endpoint.file);
  }
  const paths = new Map<string, string>();
  for (const endpoint of api) {
    const pathKey = `${endpoint.method} ${collisionKey(endpoint.pathname)}`;
    const previous = paths.get(pathKey);
    if (previous) throw new Error(`API route collision: ${previous} and ${endpoint.file} both resolve to ${pathKey}`);
    paths.set(pathKey, endpoint.file);
  }
  assertCallablePaths(api.map((endpoint) => ({ file: endpoint.file, path: `${endpoint.clientKey}.${endpoint.method.toLowerCase()}` })), "API client name collision");
  assertCallablePaths(rpc.map((endpoint) => ({ file: endpoint.file, path: endpoint.id })), "RPC collision");
  return Object.freeze({ api: Object.freeze(api), rpc: Object.freeze(rpc), socket: Object.freeze(socket) });
}
