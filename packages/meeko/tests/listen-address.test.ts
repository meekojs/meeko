import assert from "node:assert/strict";
import test from "node:test";
import { bunEntrySource, denoEntrySource } from "../src/framework/adapter-templates.ts";
import { nodeEntrySource } from "../src/framework/project-templates.ts";
import { displayHost, listeningMessage, serverUrls } from "../src/framework-server/listen-address.ts";
import type { NetworkInterfaces } from "../src/framework-server/listen-address.ts";
import { listeningMessage as internalListeningMessage } from "../src/internal.ts";

/** A machine with loopback, a LAN address, a Docker bridge and IPv6, as `os.networkInterfaces()` reports it. */
const nodeInterfaces: NetworkInterfaces = {
  lo: [
    { address: "127.0.0.1", family: "IPv4", internal: true },
    { address: "::1", family: "IPv6", internal: true },
  ],
  eth0: [
    { address: "192.168.1.20", family: "IPv4", internal: false },
    { address: "fe80::1c2d:3e4f:5a6b:7c8d", family: "IPv6", internal: false },
    { address: "2001:db8::20", family: "IPv6", internal: false },
  ],
  docker0: [{ address: "172.17.0.1", family: 4, internal: false }],
  down: undefined,
};

test("loopback and wildcard addresses are shown as localhost", () => {
  for (const host of ["127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1", "0.0.0.0", "::", "[::]", "localhost", "LOCALHOST"]) {
    assert.equal(displayHost(host), "localhost", host);
  }
  assert.equal(listeningMessage("127.0.0.1", 4173), "http://localhost:4173\n");
  assert.equal(listeningMessage("::1", 4173), "http://localhost:4173\n");
  assert.equal(serverUrls("0.0.0.0", 4173).local, "http://localhost:4173");
});

test("a concrete host is shown as it is, IPv6 between brackets", () => {
  assert.equal(displayHost("192.168.1.20"), "192.168.1.20");
  assert.equal(displayHost("fd00::20"), "[fd00::20]");
  assert.equal(displayHost("[fd00::20]"), "[fd00::20]");
  assert.equal(displayHost("app.internal"), "app.internal");
  // localhost resolves to 127.0.0.1 and ::1 only: another 127.x address stays reachable as itself.
  assert.equal(displayHost("127.0.0.2"), "127.0.0.2");
  let read = 0;
  const interfaces = () => { read++; return nodeInterfaces; };
  assert.equal(listeningMessage("192.168.1.20", 8080, interfaces), "http://192.168.1.20:8080\n");
  assert.equal(listeningMessage("127.0.0.1", 4173, interfaces), "http://localhost:4173\n");
  assert.equal(read, 0, "the interfaces are only read when the server listens on every interface");
});

test("0.0.0.0 adds the IPv4 network addresses after the local URL", () => {
  assert.deepEqual(serverUrls("0.0.0.0", 4173, () => nodeInterfaces), {
    local: "http://localhost:4173",
    network: ["http://192.168.1.20:4173", "http://172.17.0.1:4173"],
  });
  assert.equal(
    listeningMessage("0.0.0.0", 4173, () => nodeInterfaces),
    "http://localhost:4173\nRed: http://192.168.1.20:4173\nRed: http://172.17.0.1:4173\n",
  );
  // The first line stays the local URL alone, so scripts that read it keep working.
  assert.equal(listeningMessage("0.0.0.0", 4173, () => nodeInterfaces).split("\n")[0], "http://localhost:4173");
});

test(":: also adds global IPv6 addresses, never link-local or loopback ones", () => {
  assert.deepEqual(serverUrls("::", 4173, () => nodeInterfaces).network, [
    "http://192.168.1.20:4173", "http://[2001:db8::20]:4173", "http://172.17.0.1:4173",
  ]);
  // Deno.networkInterfaces() is a list without `internal`: loopback is recognized by its address.
  const deno = [
    { address: "127.0.0.1", family: "IPv4" },
    { address: "::1", family: "IPv6" },
    { address: "10.0.0.5", family: "IPv4" },
    { address: "10.0.0.5", family: "IPv4" },
  ];
  assert.deepEqual(serverUrls("0.0.0.0", 8000, () => deno).network, ["http://10.0.0.5:8000"]);
});

test("unreadable network interfaces leave only the local URL", () => {
  const denied = () => { throw new Error("Requires sys access to \"networkInterfaces\""); };
  assert.equal(listeningMessage("0.0.0.0", 4173, denied), "http://localhost:4173\n");
  assert.equal(listeningMessage("0.0.0.0", 4173, () => []), "http://localhost:4173\n");
});

test("node, bun and deno outputs print through listeningMessage", () => {
  assert.equal(internalListeningMessage, listeningMessage);
  for (const [name, source] of [["node", nodeEntrySource], ["bun", bunEntrySource], ["deno", denoEntrySource]] as const) {
    assert.match(source, /import \{ listeningMessage, meekoEnv \} from "@meekojs\/meeko\/internal";/, name);
    assert.match(source, /listeningMessage\(host, /, name);
    assert.doesNotMatch(source, /"127\.0\.0\.1" : host/, `${name} no longer maps the wildcard to 127.0.0.1 for display`);
  }
  assert.doesNotMatch(nodeEntrySource, /server\.url \+/);
  // Deno reads the interfaces only with --allow-sys granted, so a deploy without it never prompts.
  assert.match(denoEntrySource, /querySync\(\{ name: "sys", kind: "networkInterfaces" \}\)\.state === "granted"/);
});
