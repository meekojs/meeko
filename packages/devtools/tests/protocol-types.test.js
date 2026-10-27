import assert from "node:assert/strict";
import test from "node:test";
import { generateProtocolTypes, readProtocolTypes } from "../scripts/protocol-types.mjs";

test("types/protocol.d.ts coincide con src/devtools-protocol.ts", async () => {
  const expected = await generateProtocolTypes();
  assert.match(expected, /export type DevtoolsProtocolVersion = 1;/);
  assert.match(expected, /setSignal\(instanceId: string, name: string, value: DevtoolsValue\): DevtoolsCommandResult;/);
  assert.equal(await readProtocolTypes(), expected, "Ejecuta pnpm run devtools:types para regenerar la copia de la extensión");
});
