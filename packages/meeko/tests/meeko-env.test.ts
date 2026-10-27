import assert from "node:assert/strict";
import test from "node:test";
import { meekoEnv, parseDuration, resetEnvWarnings } from "../src/framework-server/env.ts";
import { meekoEnv as internalMeekoEnv } from "../src/internal.ts";

function captureWarnings(run: () => void): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  try { run(); }
  finally { console.warn = original; }
  return warnings;
}

test("MEEKO_HOST, MEEKO_PORT and MEEKO_PUBLIC_ORIGIN win over the names from before 1.2, without warnings", () => {
  resetEnvWarnings();
  const env = {
    MEEKO_HOST: "0.0.0.0", HOST: "127.0.0.1",
    MEEKO_PORT: "8080", PORT: "3000",
    MEEKO_PUBLIC_ORIGIN: "https://new.example", PUBLIC_ORIGIN: "https://old.example",
  };
  const warnings = captureWarnings(() => {
    assert.equal(meekoEnv(env, "HOST"), "0.0.0.0");
    assert.equal(meekoEnv(env, "PORT"), "8080");
    assert.equal(meekoEnv(env, "PUBLIC_ORIGIN"), "https://new.example");
  });
  assert.deepEqual(warnings, []);
  // The generated entries import the same helper from the internal entry.
  assert.equal(internalMeekoEnv, meekoEnv);
});

test("PORT stays a silent fallback because hosting platforms inject it", () => {
  resetEnvWarnings();
  const warnings = captureWarnings(() => {
    assert.equal(meekoEnv({ PORT: "3000" }, "PORT"), "3000");
    assert.equal(meekoEnv({ PORT: "3001" }, "PORT"), "3001");
  });
  assert.deepEqual(warnings, []);
});

test("HOST and PUBLIC_ORIGIN still work in 1.x and warn once each, naming the new variable", () => {
  resetEnvWarnings();
  const warnings = captureWarnings(() => {
    assert.equal(meekoEnv({ HOST: "0.0.0.0" }, "HOST"), "0.0.0.0");
    assert.equal(meekoEnv({ HOST: "0.0.0.0" }, "HOST"), "0.0.0.0");
    assert.equal(meekoEnv({ PUBLIC_ORIGIN: "https://old.example" }, "PUBLIC_ORIGIN"), "https://old.example");
    assert.equal(meekoEnv({ PUBLIC_ORIGIN: "https://old.example" }, "PUBLIC_ORIGIN"), "https://old.example");
  });
  assert.equal(warnings.length, 2, warnings.join("\n"));
  assert.match(warnings[0]!, /La variable HOST está obsoleta desde Meeko 1\.2; usa MEEKO_HOST\. HOST dejará de leerse en Meeko 2\.0/);
  assert.match(warnings[1]!, /La variable PUBLIC_ORIGIN está obsoleta desde Meeko 1\.2; usa MEEKO_PUBLIC_ORIGIN/);
});

test("empty values and non-string bindings are ignored", () => {
  resetEnvWarnings();
  assert.equal(meekoEnv({ MEEKO_PORT: "  ", PORT: "4000" }, "PORT"), "4000");
  assert.equal(meekoEnv({ MEEKO_PUBLIC_ORIGIN: { binding: true } }, "PUBLIC_ORIGIN"), undefined);
  assert.equal(meekoEnv(undefined, "HOST"), undefined);
});

test("durations accept a unit or whole milliseconds and reject anything else", () => {
  assert.equal(parseDuration("500ms", "x"), 500);
  assert.equal(parseDuration("30s", "x"), 30_000);
  assert.equal(parseDuration("5m", "x"), 300_000);
  assert.equal(parseDuration("12h", "x"), 43_200_000);
  assert.equal(parseDuration("7d", "x"), 604_800_000);
  assert.equal(parseDuration(1500, "x"), 1500);
  for (const value of ["", "12", "1.5h", "-1m", "0s", "1w", 0, -5, 1.5, Number.NaN, undefined]) {
    assert.throws(() => parseDuration(value, "MEEKO_SESSION_TTL"), /MEEKO_SESSION_TTL must be a positive duration/, String(value));
  }
});
