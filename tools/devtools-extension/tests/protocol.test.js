import assert from "node:assert/strict";
import test from "node:test";
import { commandExpression, groupInstances, normalizeSnapshot, snapshotExpression } from "../protocol.js";

test("la expresión de captura consulta el puente sin ejecutar acciones", () => {
  assert.match(snapshotExpression(), /__MEEKO_DEVTOOLS__/);
  assert.match(snapshotExpression(), /bridge\.snapshot\(\)/);
});

test("los comandos sólo aceptan operaciones conocidas y codifican los argumentos", () => {
  const maliciousId = "x'); window.evil(); //";
  const expression = commandExpression("select", [maliciousId]);
  assert.match(expression, /bridge\.select\(/);
  assert.ok(expression.includes(JSON.stringify(maliciousId)));
  assert.throws(() => commandExpression("constructor", []), TypeError);
});

test("normaliza la captura y descarta eventos con marcas temporales inválidas", () => {
  const snapshot = normalizeSnapshot({
    instances: [{ id: "i1", name: "Counter", componentId: "counter", file: "/Counter.meeko", props: { start: 1 }, signals: { count: 1 }, parentId: null, childIds: [], status: "mounted", breakpoint: false }],
    events: [
      { id: 1, at: 1234, kind: "mount", instanceId: "i1" },
      { id: 2, at: Infinity, kind: "signal", instanceId: "i1" },
    ],
    selectedId: "i1",
  });
  assert.equal(snapshot?.instances.length, 1);
  assert.equal(snapshot?.events.length, 1);
  assert.equal(snapshot?.selectedId, "i1");
  assert.equal(normalizeSnapshot({ instances: [], events: "invalid" }), null);
});

test("agrupa instancias del mismo componente", () => {
  const instances = normalizeSnapshot({
    instances: [
      { id: "a", name: "Counter", componentId: "counter", file: "Counter.meeko" },
      { id: "b", name: "Counter", componentId: "counter", file: "Counter.meeko" },
      { id: "c", name: "Card", componentId: "card", file: "Card.meeko" },
    ],
    events: [],
  })?.instances ?? [];
  const groups = groupInstances(instances);
  assert.deepEqual(groups.map((group) => [group.name, group.instances.length]), [["Card", 1], ["Counter", 2]]);
});
