import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { toNodeListener } from "../src/node.ts";

test("Node adapter forwards method, body, headers and response", async () => {
  const server = createServer(toNodeListener(async (request) => {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("x-example"), "yes");
    assert.equal(await request.text(), "payload");
    return new Response("accepted", { status: 201, headers: { "x-result": "ok" } });
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/tasks`, { method: "POST", body: "payload", headers: { "x-example": "yes" } });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-result"), "ok");
    assert.equal(await response.text(), "accepted");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
