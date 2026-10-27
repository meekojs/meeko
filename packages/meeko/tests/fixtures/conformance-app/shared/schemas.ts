import type { Schema } from "@meekojs/meeko/server";

// Hand-written Standard Schema validators keep the fixture free of dependencies.
function object<T>(check: (value: Record<string, unknown>) => boolean): Schema<T> {
  return {
    "~standard": {
      version: 1,
      validate: (value) => value !== null && typeof value === "object" && check(value as Record<string, unknown>)
        ? { value: value as T }
        : { issues: [{ message: "Invalid value" }] },
    },
  };
}

export const text = object<{ text: string }>((value) => typeof value.text === "string");
export const sequence = object<{ n: number; delay: number }>((value) => Number.isInteger(value.n) && Number.isInteger(value.delay) && (value.delay as number) >= 0 && (value.delay as number) <= 1000);
export const ack = object<{ n: number }>((value) => Number.isInteger(value.n));
export const roomText = object<{ room: string; text: string }>((value) => typeof value.room === "string" && typeof value.text === "string");
export const login = object<{ csrf: string }>((value) => typeof value.csrf === "string");
export const trace = object<{ trace: string; platform: string }>((value) => typeof value.trace === "string" && typeof value.platform === "string");
export const echo = object<{ text: string; platform: string }>((value) => typeof value.text === "string" && typeof value.platform === "string");
export const sum = object<{ a: number; b: number }>((value) => typeof value.a === "number" && typeof value.b === "number");
export const total = object<{ total: number }>((value) => typeof value.total === "number");
export const empty = object<{ ok: true }>((value) => value.ok === true);
