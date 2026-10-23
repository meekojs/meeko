import { serializeJson, type HotState } from "@meekojs/meeko";
import type { Task, TaskView } from "./model.js";

/** Renderiza HTML SSR con el estado serializado y un cliente configurable. */
export function renderPilotPage(view: TaskView, rendered: { html: string; state: HotState }, tasks: Task[], clientPath: string): string {
  const payload = serializeJson({ props: { view, tasks }, state: rendered.state });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="/meeko-logo.png"><link rel="stylesheet" href="/style.css"><title>Bandeja de trabajo · Meeko</title></head><body><main><div id="app">${rendered.html}</div></main><script id="meeko-payload" type="application/json">${payload}</script><script type="module" src="${clientPath}"></script></body></html>`;
}
