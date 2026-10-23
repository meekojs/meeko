import { hydrate, type ComponentProps } from "./Counter.generated.ts";
import type { HotState } from "meeko";

function readProps(value: unknown): ComponentProps {
  if (typeof value !== "object" || value === null || !("initial" in value)) throw new TypeError("Invalid server props");
  const initial = value.initial;
  if (typeof initial !== "number" || !Number.isFinite(initial)) throw new TypeError("Invalid initial value");
  return { initial };
}

function readPayload(value: unknown): { props: ComponentProps; state: HotState } {
  if (typeof value !== "object" || value === null || !("props" in value) || !("state" in value)) throw new TypeError("Invalid server payload");
  const props = readProps(value.props);
  const state = value.state;
  if (typeof state !== "object" || state === null || !("count" in state) || typeof state.count !== "number" || !Number.isFinite(state.count)) {
    throw new TypeError("Invalid server state");
  }
  return { props, state: { count: state.count } };
}

const root = document.getElementById("app");
const payload = document.getElementById("meeko-payload");
if (!root || !payload?.textContent) throw new Error("Missing SSR root or props");
const { props, state } = readPayload(JSON.parse(payload.textContent) as unknown);
hydrate(root, props, state);
