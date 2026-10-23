// @ts-check

import { commandExpression, groupInstances, normalizeSnapshot, snapshotExpression } from "./protocol.js";

/** @typedef {import('./protocol.js').DevtoolsSnapshot} DevtoolsSnapshot */
/** @typedef {import('./protocol.js').DevtoolsInstance} DevtoolsInstance */

const connection = required("connection");
const instanceCount = required("instance-count");
const instanceList = required("instance-list");
const detailEmpty = required("detail-empty");
const emptyTitle = required("empty-title");
const emptyDescription = required("empty-description");
const detailContent = required("detail-content");
const detailName = required("detail-name");
const detailFile = required("detail-file");
const detailId = required("detail-id");
const detailParent = required("detail-parent");
const detailChildren = required("detail-children");
const detailStatus = required("detail-status");
const propsValue = required("props-value");
const signalsValue = required("signals-value");
const highlightButton = /** @type {HTMLButtonElement} */ (required("highlight"));
const breakpointButton = /** @type {HTMLButtonElement} */ (required("breakpoint"));
const search = /** @type {HTMLInputElement} */ (required("search"));
const selectedEvents = /** @type {HTMLInputElement} */ (required("selected-events"));
const eventList = required("event-list");
const eventCount = required("event-count");

/** @type {DevtoolsSnapshot | null} */
let snapshot = null;
/** @type {string | null} */
let highlightedId = null;
/** @type {ReturnType<typeof setInterval> | undefined} */
let timer;
let inFlight = false;
let signature = "";

/** Obtiene un elemento obligatorio de la interfaz. */
function required(/** @type {string} */ id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing panel element: ${id}`);
  return element;
}

/** Ejecuta una expresión pequeña en el marco principal inspeccionado. */
function evaluate(/** @type {string} */ expression) {
  return new Promise(/** @type {(resolve:(value:unknown)=>void,reject:(reason:Error)=>void)=>void} */ ((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(expression, (result, exception) => {
      if (exception) {
        reject(new Error(exception.value ?? exception.description ?? "Inspected window evaluation failed"));
      } else {
        resolve(result);
      }
    });
  }));
}

/** Solicita una acción concreta al runtime Meeko. */
async function command(/** @type {'select'|'highlight'|'setBreakpoint'} */ action, /** @type {unknown[]} */ args) {
  const result = await evaluate(commandExpression(action, args));
  if (!result || typeof result !== "object" || !(/** @type {{ok?:boolean}} */ (result)).ok) {
    throw new Error("Meeko DevTools no está disponible en esta página");
  }
  await refresh();
}

/** Actualiza los datos mientras el panel está visible. */
async function refresh() {
  if (inFlight) return;
  inFlight = true;
  try {
    const raw = await evaluate(snapshotExpression());
    const next = normalizeSnapshot(raw);
    if (!next) {
      setConnection("Meeko no detectado", true);
      if (snapshot) {
        snapshot = null;
        signature = "";
        render();
      }
      return;
    }
    setConnection("Meeko activo", false);
    const nextSignature = JSON.stringify(next);
    if (nextSignature !== signature) {
      snapshot = next;
      signature = nextSignature;
      if (highlightedId && !next.instances.some((item) => item.id === highlightedId)) highlightedId = null;
      render();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setConnection(`Error: ${message}`, true);
  } finally {
    inFlight = false;
  }
}

function setConnection(/** @type {string} */ message, /** @type {boolean} */ offline) {
  connection.textContent = message;
  connection.classList.toggle("offline", offline);
  connection.title = message;
}

/** Crea un nodo con texto; nunca interpreta valores de la aplicación como HTML. */
function node(/** @type {keyof HTMLElementTagNameMap} */ tag, /** @type {string} */ text, /** @type {string} */ className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

/** Recupera el foco de un botón tras actualizar el árbol. */
function restoreFocus(/** @type {string | undefined} */ id) {
  if (!id) return;
  const buttons = instanceList.querySelectorAll("button[data-instance-id]");
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement && button.dataset.instanceId === id) {
      button.focus({ preventScroll: true });
      break;
    }
  }
}

function renderInstances() {
  const focusedId = document.activeElement instanceof HTMLButtonElement && instanceList.contains(document.activeElement)
    ? document.activeElement.dataset.instanceId : undefined;
  const instances = snapshot?.instances ?? [];
  instanceCount.textContent = String(instances.length);
  const filter = search.value.trim().toLocaleLowerCase();
  const groups = groupInstances(instances).filter((group) => `${group.name} ${group.file}`.toLocaleLowerCase().includes(filter));
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "group";
    const heading = node("div", group.name, "group-heading");
    heading.append(node("span", String(group.instances.length)));
    heading.title = group.file;
    section.append(heading);
    const list = document.createElement("ul");
    for (const instance of group.instances) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "instance-button";
      button.dataset.instanceId = instance.id;
      button.setAttribute("aria-current", String(instance.id === snapshot?.selectedId));
      button.setAttribute("aria-label", `${instance.name}, instancia ${instance.id}${instance.breakpoint ? ", breakpoint activo" : ""}`);
      button.append(node("span", instance.id, "id"));
      if (instance.breakpoint) button.append(node("span", "", "breakpoint-dot"));
      button.addEventListener("click", () => { void selectInstance(instance.id); });
      item.append(button);
      list.append(item);
    }
    section.append(list);
    fragment.append(section);
  }
  if (!groups.length) fragment.append(node("p", filter ? "No hay componentes que coincidan." : "Todavía no hay instancias hidratadas.", "list-empty"));
  instanceList.replaceChildren(fragment);
  restoreFocus(focusedId);
}

function valueText(/** @type {unknown} */ value) {
  if (value === undefined) return "—";
  try {
    const serialized = JSON.stringify(value, null, 2) ?? String(value);
    return serialized.length > 100_000 ? `${serialized.slice(0, 100_000)}\n… (valor truncado)` : serialized;
  } catch {
    return "(valor no serializable)";
  }
}

function renderDetails() {
  const selected = snapshot?.instances.find((item) => item.id === snapshot?.selectedId);
  detailEmpty.hidden = Boolean(selected);
  detailContent.hidden = !selected;
  if (!selected) {
    emptyTitle.textContent = snapshot ? "Selecciona una instancia" : "Meeko no detectado";
    emptyDescription.textContent = snapshot
      ? "Examina sus propiedades, señales y relación con otros componentes."
      : "Abre una aplicación Meeko con Vite en desarrollo y espera a que se hidrate.";
    return;
  }
  detailName.textContent = selected.name;
  detailFile.textContent = selected.file || selected.componentId;
  detailId.textContent = selected.id;
  detailParent.textContent = selected.parentId ?? "—";
  detailChildren.textContent = selected.childIds.length ? selected.childIds.join(", ") : "—";
  detailStatus.textContent = selected.status === "hydrated" ? "Hidratado" : selected.status;
  propsValue.textContent = valueText(selected.props);
  signalsValue.textContent = valueText(selected.signals);
  const highlighted = highlightedId === selected.id;
  highlightButton.setAttribute("aria-pressed", String(highlighted));
  highlightButton.textContent = highlighted ? "Quitar resaltado" : "Resaltar DOM";
  breakpointButton.setAttribute("aria-pressed", String(selected.breakpoint));
  breakpointButton.textContent = selected.breakpoint ? "Desactivar breakpoint" : "Activar breakpoint";
}

function eventTime(/** @type {number} */ at) {
  if (at > 1_000_000_000_000) return new Date(at).toLocaleTimeString();
  return `${(at / 1000).toFixed(2)} s`;
}

function renderEvents() {
  const all = snapshot?.events ?? [];
  const selectedId = snapshot?.selectedId;
  const events = selectedEvents.checked ? all.filter((event) => event.instanceId === selectedId) : all;
  eventCount.textContent = String(events.length);
  const fragment = document.createDocumentFragment();
  for (const event of [...events].reverse()) {
    const item = document.createElement("li");
    const time = node("time", eventTime(event.at));
    if (event.at > 1_000_000_000_000) time.setAttribute("datetime", new Date(event.at).toISOString());
    item.append(time, node("span", event.kind, "event-kind"), node("span", event.instanceId, "event-id"), node("span", event.detail ?? "", "event-detail"));
    fragment.append(item);
  }
  if (!events.length) fragment.append(node("li", selectedEvents.checked && !selectedId ? "Selecciona una instancia para ver sus eventos." : "Sin eventos registrados.", "list-empty"));
  eventList.replaceChildren(fragment);
}

function render() {
  renderInstances();
  renderDetails();
  renderEvents();
}

async function selectInstance(/** @type {string} */ id) {
  try {
    if (highlightedId && highlightedId !== id) {
      await command("highlight", [null]);
      highlightedId = null;
    }
    await command("select", [id]);
  } catch (error) {
    setConnection(error instanceof Error ? error.message : String(error), true);
  }
}

highlightButton.addEventListener("click", async () => {
  const id = snapshot?.selectedId;
  if (!id) return;
  try {
    const next = highlightedId === id ? null : id;
    await command("highlight", [next]);
    highlightedId = next;
    renderDetails();
  } catch (error) {
    setConnection(error instanceof Error ? error.message : String(error), true);
  }
});

breakpointButton.addEventListener("click", async () => {
  const selected = snapshot?.instances.find((item) => item.id === snapshot?.selectedId);
  if (!selected) return;
  try {
    await command("setBreakpoint", [selected.id, !selected.breakpoint]);
  } catch (error) {
    setConnection(error instanceof Error ? error.message : String(error), true);
  }
});

search.addEventListener("input", renderInstances);
selectedEvents.addEventListener("change", renderEvents);
instanceList.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const buttons = [...instanceList.querySelectorAll("button[data-instance-id]")];
  const index = document.activeElement ? buttons.indexOf(document.activeElement) : -1;
  const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
  if (next instanceof HTMLButtonElement) {
    next.focus();
    event.preventDefault();
  }
});

function startPolling() {
  if (timer) return;
  void refresh();
  timer = setInterval(() => { void refresh(); }, 700);
}

function stopPolling() {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || !event.data || event.data.source !== "meeko-devtools") return;
  if (event.data.visible) startPolling();
  else stopPolling();
});
document.addEventListener("visibilitychange", () => { if (document.hidden) stopPolling(); else startPolling(); });
window.addEventListener("unload", () => {
  stopPolling();
  if (highlightedId) void evaluate(commandExpression("highlight", [null]));
});

startPolling();
