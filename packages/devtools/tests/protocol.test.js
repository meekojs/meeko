import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPORTED_PROTOCOL_VERSION, commandExpression, groupInstances, normalizeCommandResult, normalizeSnapshot, parseSignalValue,
  protocolMismatch, readKindLabel, snapshotExpression, writeLabel,
} from "../protocol.js";

/** Evalúa una expresión del puente contra un `window` simulado, como haría `inspectedWindow.eval`. */
function evaluateWith(bridge, expression) {
  return new Function("window", `return ${expression};`)({ __MEEKO_DEVTOOLS__: bridge });
}

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
  assert.throws(() => commandExpression("snapshot", []), TypeError);
});

test("setSignal forma parte de la lista cerrada y devuelve el resultado del runtime", () => {
  const calls = [];
  const bridge = {
    protocolVersion: 1,
    setSignal(id, name, value) {
      calls.push([id, name, value]);
      return name === "count" ? { ok: true } : { ok: false, error: "no writable signal" };
    },
  };
  const value = { label: "\"); window.evil(); //", items: [1, null, true] };
  assert.deepEqual(evaluateWith(bridge, commandExpression("setSignal", ["meeko-1", "count", value])), { ok: true });
  assert.deepEqual(calls, [["meeko-1", "count", value]]);
  assert.deepEqual(evaluateWith(bridge, commandExpression("setSignal", ["meeko-1", "other", 1])), { ok: false, error: "no writable signal" });
  assert.deepEqual(evaluateWith({ protocolVersion: 1, setSignal() { throw new Error("boom"); } }, commandExpression("setSignal", ["a", "b", 1])), { ok: false, error: "boom" });
  assert.deepEqual(evaluateWith(undefined, commandExpression("setSignal", ["a", "b", 1])), { ok: false, error: "Meeko DevTools unavailable" });
  assert.deepEqual(evaluateWith({ setSignal() { return { ok: true }; } }, commandExpression("setSignal", ["a", "b", 1])), { ok: false, error: "Unsupported Meeko DevTools protocol" });
  assert.deepEqual(normalizeCommandResult({ ok: true, extra: 1 }), { ok: true });
  assert.deepEqual(normalizeCommandResult({ ok: false, error: "x" }), { ok: false, error: "x" });
  assert.equal(normalizeCommandResult(null).ok, false);
});

test("el protocolo exige la versión 1 y explica las versiones desconocidas", () => {
  assert.equal(SUPPORTED_PROTOCOL_VERSION, 1);
  assert.equal(protocolMismatch(null), null);
  assert.equal(protocolMismatch({ protocolVersion: 1, instances: [], events: [] }), null);
  assert.match(protocolMismatch({ instances: [], events: [] }) ?? "", /sin versión de protocolo.*admite el protocolo 1/);
  assert.match(protocolMismatch({ protocolVersion: 2, instances: [], events: [] }) ?? "", /protocolo DevTools 2 y esta extensión admite el 1\. Actualiza la extensión/);
  assert.match(protocolMismatch({ protocolVersion: "1" }) ?? "", /protocolo DevTools "1"/);
  assert.equal(normalizeSnapshot({ instances: [], events: [], selectedId: null }), null);
  assert.equal(normalizeSnapshot({ protocolVersion: 2, instances: [], events: [], selectedId: null }), null);
});

test("normaliza la captura y descarta eventos con marcas temporales inválidas", () => {
  const snapshot = normalizeSnapshot({
    protocolVersion: 1,
    instances: [{ id: "i1", name: "Counter", componentId: "counter", file: "/Counter.meeko", props: { start: 1 }, signals: { count: 1 }, parentId: null, childIds: [], status: "mounted", breakpoint: false }],
    events: [
      { id: 1, at: 1234, kind: "signal", instanceId: "i1", detail: "count", componentName: "Counter", file: "/Counter.meeko", value: 2, reads: [{ file: "/Counter.meeko", line: 3, column: 8, expression: "count.value", kind: "text" }, { file: "bad", line: -1, column: 1, expression: "bad", kind: "text" }] },
      { id: 2, at: Infinity, kind: "signal", instanceId: "i1" },
      { id: 3, at: 1, kind: "unknown", instanceId: "i1" },
    ],
    selectedId: "i1",
  });
  assert.equal(snapshot?.protocolVersion, 1);
  assert.equal(snapshot?.instances.length, 1);
  assert.equal(snapshot?.instances[0]?.status, "hydrated");
  assert.equal(snapshot?.events.length, 1);
  assert.deepEqual(snapshot?.events[0], { id: 1, at: 1234, kind: "signal", instanceId: "i1", detail: "count", componentName: "Counter", file: "/Counter.meeko", value: 2, reads: [{ file: "/Counter.meeko", line: 3, column: 8, expression: "count.value", kind: "text" }] });
  assert.equal(snapshot?.selectedId, "i1");
  assert.equal(normalizeSnapshot({ protocolVersion: 1, instances: [], events: "invalid" }), null);
});

test("normaliza lecturas de computed, condiciones, listas y props y el origen de la escritura", () => {
  const read = (kind, extra = {}) => ({ file: "/A.meeko", line: 2, column: 3, expression: "count.value", kind, ...extra });
  const snapshot = normalizeSnapshot({
    protocolVersion: 1,
    instances: [],
    events: [
      { id: 1, at: 1, kind: "signal", instanceId: "i", reads: [read("computed"), read("if"), read("each"), read("prop", { name: "label" }), read("unknown"), read("prop", { name: 3 })], write: { kind: "assignment", file: "/A.meeko", line: 9, column: 3, expression: "count.value++" } },
      { id: 2, at: 2, kind: "signal", instanceId: "i", write: { kind: "devtools", extra: true } },
      { id: 3, at: 3, kind: "signal", instanceId: "i", write: { kind: "assignment", file: "/A.meeko", line: 0, column: 1, expression: "x" } },
    ],
    selectedId: null,
  });
  assert.deepEqual(snapshot?.events[0]?.reads?.map((site) => [site.kind, site.name]), [["computed", undefined], ["if", undefined], ["each", undefined], ["prop", "label"], ["prop", undefined]]);
  assert.deepEqual(snapshot?.events[0]?.write, { kind: "assignment", file: "/A.meeko", line: 9, column: 3, expression: "count.value++" });
  assert.deepEqual(snapshot?.events[1]?.write, { kind: "devtools" });
  assert.equal(snapshot?.events[2]?.write, undefined);
  assert.equal(readKindLabel(read("prop", { name: "label" })), "prop label");
  assert.equal(readKindLabel(read("if")), "if:when");
  assert.equal(writeLabel({ kind: "devtools" }), "Escrita desde DevTools");
  assert.equal(writeLabel({ kind: "assignment", file: "/A.meeko", line: 9, column: 3, expression: "x" }), "Escrita en /A.meeko:9:3");
});

test("valida el JSON del editor de señales", () => {
  assert.deepEqual(parseSignalValue(' {"a": [1, null]} '), { ok: true, value: { a: [1, null] } });
  assert.deepEqual(parseSignalValue("0"), { ok: true, value: 0 });
  assert.equal(parseSignalValue("").ok, false);
  const invalid = parseSignalValue("{ a: 1 }");
  assert.equal(invalid.ok, false);
  assert.match(invalid.ok ? "" : invalid.error, /^JSON no válido/);
});

test("agrupa instancias del mismo componente", () => {
  const instances = normalizeSnapshot({
    protocolVersion: 1,
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
