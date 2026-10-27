import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { devPortInUse, hmrPortFor, isPortFree, resolveDevPorts } from "../src/framework/dev-port.ts";

/** A probe over a fixed set of busy `host:port` pairs. */
const busy = (...pairs: string[]) => {
  const taken = new Set(pairs);
  return async (port: number, host: string) => !taken.has(`${host}:${port}`);
};

test("without an explicit port dev takes the first free one from 4173 and derives HMR from it", async () => {
  assert.deepEqual(await resolveDevPorts({ host: "127.0.0.1", free: busy() }), { port: 4173, hmrPort: hmrPortFor(4173) });
  // Another meeko dev holds 4173 and its HMR port.
  assert.deepEqual(await resolveDevPorts({ host: "127.0.0.1", free: busy("127.0.0.1:4173", `127.0.0.1:${hmrPortFor(4173)}`) }),
    { port: 4174, hmrPort: hmrPortFor(4174), busy: 4173 });
  // A free HTTP port whose HMR port is taken is skipped as well.
  assert.deepEqual(await resolveDevPorts({ host: "127.0.0.1", free: busy(`127.0.0.1:${hmrPortFor(4173)}`) }),
    { port: 4174, hmrPort: hmrPortFor(4174), busy: 4173 });
  // MEEKO_HMR_PORT is used as is.
  assert.deepEqual(await resolveDevPorts({ host: "127.0.0.1", hmrPort: 9999, free: busy("127.0.0.1:4173", "127.0.0.1:9999") }),
    { port: 4174, hmrPort: 9999, busy: 4173 });
});

test("dev gives up with a clear message when the whole range is in use", async () => {
  await assert.rejects(resolveDevPorts({ host: "127.0.0.1", attempts: 3, free: async () => false }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as NodeJS.ErrnoException).code, "EADDRINUSE");
    assert.match(error.message, /Los puertos 4173–4175 de 127\.0\.0\.1 ya están en uso; usa MEEKO_PORT=/);
    return true;
  });
});

test("an explicit port is kept even when in use; only its HMR port moves", async () => {
  assert.deepEqual(await resolveDevPorts({ host: "127.0.0.1", port: 5000, free: busy("127.0.0.1:5000") }), { port: 5000, hmrPort: hmrPortFor(5000) });
  // The other server on 5000 holds the derived HMR port: dev reports the HTTP port, not Vite's WebSocket.
  assert.deepEqual(await resolveDevPorts({ host: "127.0.0.1", port: 5000, free: busy("127.0.0.1:5000", `127.0.0.1:${hmrPortFor(5000)}`) }),
    { port: 5000, hmrPort: hmrPortFor(5000) + 1 });
  assert.deepEqual(await resolveDevPorts({ host: "127.0.0.1", port: 5000, hmrPort: 6000, free: async () => false }), { port: 5000, hmrPort: 6000 });
});

test("the port probe sees a listening server", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    assert.equal(await isPortFree(address.port, "127.0.0.1"), false);
  } finally {
    server.close();
    await once(server, "close");
  }
  assert.equal(await isPortFree(address.port, "127.0.0.1"), true);
});

test("a port in use names the port and how to fix it", () => {
  const cause = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
  const error = devPortInUse(4173, "127.0.0.1", cause);
  assert.equal((error as NodeJS.ErrnoException).code, "EADDRINUSE");
  assert.equal(error.cause, cause);
  assert.equal(error.message, "El puerto 4173 de 127.0.0.1 ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev");
});
