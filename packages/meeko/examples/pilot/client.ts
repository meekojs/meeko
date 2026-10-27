import { hydrate, type ComponentProps } from "./App.meeko";
import type { HotState } from "@meekojs/meeko";
import { parseTasks } from "./model.js";

/** Comprueba el límite JSON antes de conectar los eventos del cliente. */
function readPayload(value: unknown): { props: ComponentProps; state: HotState } {
  if (typeof value !== "object" || value === null) throw new TypeError("Falta el payload SSR.");
  const payload = value as Record<string, unknown>;
  const props = payload.props;
  if (typeof props !== "object" || props === null) throw new TypeError("Props SSR inválidas.");
  const candidate = props as Record<string, unknown>;
  if (candidate.view !== "active" && candidate.view !== "completed") throw new TypeError("Vista SSR inválida.");
  const tasks = parseTasks(candidate.tasks);
  const state = payload.state;
  if (typeof state !== "object" || state === null || Array.isArray(state)) throw new TypeError("Estado SSR inválido.");
  return { props: { view: candidate.view, tasks }, state: state as HotState };
}

const root = document.getElementById("app");
const payloadNode = document.getElementById("meeko-payload");
if (!root || !payloadNode?.textContent) throw new Error("Falta el HTML del servidor.");
const { props, state } = readPayload(JSON.parse(payloadNode.textContent) as unknown);
hydrate(root, props, state);
document.documentElement.dataset.hydrated = "true";
