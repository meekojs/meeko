import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import { hashPassword, needsRehash, verifyPassword } from "../src/password.ts";
import { promptPassword, PromptCancelled } from "../src/password-prompt.ts";

// A hash in the format that apps wrote by hand before 1.2: scrypt N=2^17, r=8, p=1, a 32-byte salt
// and a 64-byte key. Generated once with node:crypto for the password below.
const legacyVector = "scrypt$131072$8$1$AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dw$3D7fV8nN5kODYbNjXozoRlDeepCygDtNHxbAo8RfpTWdblpBKDZtgh9l2BqqFkhydVo70a9Tu1biBLQBZtExbA";

test("hashPassword writes the self-describing scrypt format and verifyPassword accepts only the same password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.match(hash, /^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.notEqual(await hashPassword("correct horse battery staple"), hash, "every hash has its own salt");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("correct horse battery stapl", hash), false);
  assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
  assert.equal(needsRehash(hash), false);
});

test("hashes written before 1.2 in the same format still verify, with their own salt and key lengths", async () => {
  assert.equal(await verifyPassword("correct horse battery staple", legacyVector), true);
  assert.equal(await verifyPassword("wrong", legacyVector), false);
  assert.equal(needsRehash(legacyVector), false, "a 32-byte salt and a 64-byte key exceed the defaults");
  // The same derivation as the hand-written setup scripts.
  const salt = randomBytes(32);
  const key = scryptSync("ñandú 🦤 secreto", salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const handWritten = `scrypt$131072$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
  assert.equal(await verifyPassword("ñandú 🦤 secreto", handWritten), true);
  assert.equal(await verifyPassword("nandu secreto", handWritten), false);
});

test("needsRehash flags weaker parameters and invalid hashes", () => {
  const salt = Buffer.alloc(16, 1).toString("base64url");
  const key = Buffer.alloc(32, 2).toString("base64url");
  assert.equal(needsRehash(`scrypt$16384$8$1$${salt}$${key}`), true, "a lower cost");
  assert.equal(needsRehash(`scrypt$131072$4$1$${salt}$${key}`), true, "a smaller block");
  assert.equal(needsRehash(`scrypt$131072$8$1$${Buffer.alloc(8).toString("base64url")}$${key}`), true, "a short salt");
  assert.equal(needsRehash(`scrypt$131072$8$1$${salt}$${Buffer.alloc(16).toString("base64url")}`), true, "a short key");
  assert.equal(needsRehash(`scrypt$262144$8$1$${salt}$${key}`), false, "a higher cost is fine");
  assert.equal(needsRehash("bcrypt$2b$12$abc"), true);
  assert.equal(needsRehash(""), true);
});

test("a malformed or out-of-bounds hash is a configuration error, never a wrong password", async () => {
  const salt = Buffer.alloc(16, 1).toString("base64url");
  const key = Buffer.alloc(32, 2).toString("base64url");
  for (const hash of [
    "", "scrypt", `scrypt$131072$8$1$${salt}`, `scrypt$100000$8$1$${salt}$${key}`, `scrypt$${2 ** 21}$8$1$${salt}$${key}`,
    `scrypt$131072$0$1$${salt}$${key}`, `scrypt$131072$8$99$${salt}$${key}`, `scrypt$131072$8$1$${salt}=$${key}`,
    `scrypt$131072$8$1$${salt}$${key}$extra`, ` scrypt$131072$8$1$${salt}$${key}`,
  ]) {
    await assert.rejects(verifyPassword("x", hash), /Invalid password hash/, JSON.stringify(hash));
  }
  await assert.rejects(verifyPassword("x", undefined as never), /Invalid password hash/);
});

test("passwords must be strings of 1 to 4096 bytes", async () => {
  await assert.rejects(hashPassword(""), /The password is empty/);
  await assert.rejects(hashPassword("x".repeat(4097)), /exceeds 4096 bytes/);
  await assert.rejects(hashPassword(42 as never), /must be a string/);
  // Verification answers false without deriving anything.
  assert.equal(await verifyPassword("", legacyVector), false);
  assert.equal(await verifyPassword("é".repeat(2049), legacyVector), false, "4098 UTF-8 bytes");
});

test("meeko auth hash reads a piped password and prints only the hash line", async () => {
  const result = spawnSync(process.execPath, [resolve("dist/cli.js"), "auth", "hash"], { input: "correct horse battery staple\n", encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+\n$/);
  assert.equal(await verifyPassword("correct horse battery staple", result.stdout.trim()), true);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /correct horse/, "the password is never echoed");
  const empty = spawnSync(process.execPath, [resolve("dist/cli.js"), "auth", "hash"], { input: "\n", encoding: "utf8", windowsHide: true });
  assert.equal(empty.status, 1);
  assert.equal(empty.stdout, "");
  assert.equal(empty.stderr, "La contraseña está vacía\n");
  const lines = spawnSync(process.execPath, [resolve("dist/cli.js"), "auth", "hash"], { input: "one\ntwo\n", encoding: "utf8", windowsHide: true });
  assert.equal(lines.status, 1);
  assert.match(lines.stderr, /una sola línea/);
  const unknown = spawnSync(process.execPath, [resolve("dist/cli.js"), "auth", "verify"], { encoding: "utf8", windowsHide: true });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /^Subcomando desconocido de auth: verify/);
});

/** A terminal in raw mode that types `keys` once the prompt listens. */
class FakeTerminal extends EventEmitter {
  readonly isTTY = true;
  rawModes: boolean[] = [];
  /** One entry per prompt: its keys, or the chunks in which the terminal delivers them. */
  constructor(private readonly keystrokes: (string | string[])[]) { super(); }
  setRawMode(mode: boolean): void { this.rawModes.push(mode); }
  setEncoding(): void {}
  pause(): void {}
  resume(): void {
    const next = this.keystrokes.shift();
    if (next === undefined) return;
    const chunks = typeof next === "string" ? [next] : next;
    setImmediate(() => { for (const chunk of chunks) this.emit("data", chunk); });
  }
}

test("the terminal prompt drops whole escape sequences and other control characters", async () => {
  const output = { write: () => {} };
  // Arrows (CSI and SS3), Home, Delete, F5, Alt+x, a bracketed paste, a title (OSC), Tab and Ctrl+U.
  const typed = "se\u001b[A\u001bOBc\u001b[H\u001b[3~r\u001b[15~e\u001bx\u001b[200~t\u001b[201~\u001b]0;t\u0007\t\u0015";
  assert.equal(await promptPassword(new FakeTerminal([`${typed}\r`, "secret\r"]), output), "secret");
  // A sequence split across chunks, an 8-bit CSI and a lone Escape key.
  const split = ["se\u001b[", "1;5", "Ccr", "\u009bDet\u001b", "\r"];
  assert.equal(await promptPassword(new FakeTerminal([split, "secret\r"]), output), "secret");
  assert.equal(await promptPassword(new FakeTerminal(["añ\u001b[D€\r", "añ€\r"]), output), "añ€", "text after a sequence is kept");
});

test("the terminal prompt reads twice in raw mode without echo, with Backspace, and rejects a mismatch or Ctrl+C", async () => {
  let written = "";
  const output = { write: (text: string) => { written += text; } };
  const terminal = new FakeTerminal(["secrex\u007ft\r", "secret\r"]);
  assert.equal(await promptPassword(terminal, output), "secret");
  assert.deepEqual(terminal.rawModes, [true, false, true, false], "raw mode is restored after each prompt");
  assert.equal(written, "Contraseña: \nRepite la contraseña: \n", "nothing typed is echoed");
  await assert.rejects(promptPassword(new FakeTerminal(["one\r", "two\r"]), output), /Las contraseñas no coinciden/);
  await assert.rejects(promptPassword(new FakeTerminal(["\u0003"]), output), (error) => error instanceof PromptCancelled);
  await assert.rejects(promptPassword(new FakeTerminal(["\r"]), output), /La contraseña está vacía/);
  // An empty pipe gets the same message, not the English one of hashPassword.
  const pipe = (text: string) => ({ isTTY: false, async *[Symbol.asyncIterator]() { yield text; } });
  await assert.rejects(promptPassword(pipe("\n") as never, output), { message: "La contraseña está vacía" });
  assert.equal(await promptPassword(pipe("secret\n") as never, output), "secret");
  await assert.rejects(promptPassword(pipe(`${"ñ".repeat(2049)}\n`) as never, output), { message: "La contraseña supera 4096 bytes" });
});
