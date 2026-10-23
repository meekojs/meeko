import type { DevtoolsEvent, DevtoolsHook, DevtoolsInstance } from "../devtools.js";

/** Opciones de montaje del panel integrado de desarrollo. */
export interface DevtoolsPanelOptions {
  /** Elemento que recibirá el host del Shadow DOM. El valor predeterminado es `document.body`. */
  container?: Element;
}

/** Control del ciclo de vida del panel. */
export interface DevtoolsPanel {
  /** Reintenta encontrar el hook y actualiza los datos visibles. */
  refresh(): void;
  /** Quita la interfaz y libera las suscripciones y eventos instalados. */
  unmount(): void;
}

const styles = `
:host { all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: min(680px, calc(100vw - 32px)); color: #e8ecf5; font: 13px/1.45 system-ui, sans-serif; color-scheme: dark; }
* { box-sizing: border-box; }
.panel { display: flex; flex-direction: column; max-height: min(560px, calc(100vh - 32px)); overflow: hidden; border: 1px solid #475569; border-radius: 12px; background: #101827; box-shadow: 0 16px 48px #0009; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #334155; }
header strong { font-size: 14px; margin-right: auto; }
.mobile-switch { display: none; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #334155; }
.mobile-switch button { flex: 1; }
.content { display: grid; grid-template-columns: minmax(170px, 0.9fr) minmax(0, 1.6fr); min-height: 220px; overflow: auto; }
section { min-width: 0; padding: 12px; }
section + section { border-left: 1px solid #334155; }
h2, h3 { margin: 0 0 8px; font-size: 13px; }
h3 { margin-top: 12px; }
p { margin: 0 0 8px; color: #aab7ca; }
ul, ol { margin: 0; padding: 0; list-style: none; }
li + li { margin-top: 6px; }
button { appearance: none; border: 1px solid #52657d; border-radius: 6px; background: #202d40; color: inherit; padding: 5px 8px; font: inherit; cursor: pointer; }
button:hover { background: #30425d; }
button:focus-visible { outline: 2px solid #79b8ff; outline-offset: 2px; }
button[aria-pressed="true"] { border-color: #79b8ff; background: #25476c; }
.tree-node { margin: 3px 0; }
.tree-node > button { width: 100%; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-children { margin: 4px 0 6px 8px; padding-left: 12px; border-left: 1px solid #52657d; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.muted { color: #aab7ca; }
.path { overflow-wrap: anywhere; }
pre { margin: 4px 0 0; padding: 8px; max-height: 130px; overflow: auto; border-radius: 6px; background: #0a111e; color: #dbeafe; font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.events { border-top: 1px solid #334155; padding: 10px 12px; max-height: 160px; overflow: auto; }
.events-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
.events-head label { color: #aab7ca; }
.event-button { width: 100%; text-align: left; }
.event-reads { margin: 4px 0 8px; color: #aab7ca; }
.event-reads summary { cursor: pointer; }
.event-reads li { overflow-wrap: anywhere; }
.event-reads code { color: #dbeafe; }
.events li { overflow-wrap: anywhere; }
.status { padding: 7px 12px; border-top: 1px solid #334155; color: #aab7ca; }
@media (max-width: 540px) {
  .mobile-switch { display: flex; }
  .content { display: block; min-height: 0; }
  .content[data-view="instances"] .detail { display: none; }
  .content[data-view="detail"] .instances { display: none; }
  section + section { border-left: 0; }
}
`;

/** Formatea datos arbitrarios sin insertar HTML procedente de la aplicación. */
function formatValue(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const result = JSON.stringify(value, (_key, current: unknown) => {
      if (typeof current === "bigint") return `${current}n`;
      if (typeof current === "function") return "[función]";
      if (typeof current === "symbol") return String(current);
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) return "[circular]";
        seen.add(current);
      }
      return current;
    }, 2);
    return (result ?? String(value)).slice(0, 8000);
  } catch {
    return "[valor no representable]";
  }
}

/** Crea un elemento con texto seguro y una clase opcional. */
function element<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** Muestra el momento relativo comunicado por el runtime. */
function eventLabel(event: DevtoolsEvent): string {
  const kinds: Record<DevtoolsEvent["kind"], string> = {
    mount: "Montaje",
    unmount: "Desmontaje",
    signal: "Señal",
    breakpoint: "Punto de parada",
    select: "Selección",
    hmr: "HMR",
  };
  const time = Number.isFinite(event.at) ? new Date(event.at).toLocaleTimeString("es", { hour12: false }) : "hora desconocida";
  const detail = event.detail ? ` · ${event.detail}` : "";
  const source = event.componentName ? ` · ${event.componentName}` : "";
  const file = event.file ? ` · ${event.file}` : "";
  const value = event.kind === "signal" && "value" in event ? ` → ${formatValue(event.value).replace(/\s+/g, " ").slice(0, 240)}` : "";
  return `${time} · ${kinds[event.kind]} · ${event.instanceId}${source}${file}${detail}${value}`;
}

/** Exige un documento conectado a una ventana para registrar eventos del hook. */
function requireView(document: Document): Window {
  const view = document.defaultView;
  if (!view) throw new Error("Meeko DevTools requires a browser document");
  return view;
}

/** Monta una interfaz aislada en Shadow DOM para inspeccionar instancias Meeko. */
export function mountDevtoolsPanel(options: DevtoolsPanelOptions = {}): DevtoolsPanel {
  const container = options.container ?? document.body;
  const ownerDocument = container.ownerDocument;
  const view = requireView(ownerDocument);

  const host = element(ownerDocument, "div");
  host.setAttribute("data-meeko-devtools-panel", "");
  const shadow = host.attachShadow({ mode: "open" });
  const style = element(ownerDocument, "style", styles);
  const panel = element(ownerDocument, "div", undefined, "panel");
  const header = element(ownerDocument, "header");
  const title = element(ownerDocument, "strong", "Meeko DevTools");
  const refreshButton = element(ownerDocument, "button", "Actualizar");
  refreshButton.type = "button";
  refreshButton.setAttribute("aria-label", "Actualizar instancias de Meeko");
  const closeButton = element(ownerDocument, "button", "Cerrar");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Cerrar Meeko DevTools");
  header.append(title, refreshButton, closeButton);

  const mobileSwitch = element(ownerDocument, "nav", undefined, "mobile-switch");
  mobileSwitch.setAttribute("aria-label", "Vistas de Meeko DevTools");
  const instancesButton = element(ownerDocument, "button", "Instancias");
  instancesButton.type = "button";
  instancesButton.setAttribute("aria-controls", "meeko-devtools-instances");
  const detailButton = element(ownerDocument, "button", "Detalle");
  detailButton.type = "button";
  detailButton.setAttribute("aria-controls", "meeko-devtools-detail");
  mobileSwitch.append(instancesButton, detailButton);

  const main = element(ownerDocument, "div", undefined, "content");
  const instancesSection = element(ownerDocument, "section", undefined, "instances");
  instancesSection.id = "meeko-devtools-instances";
  const instancesTitle = element(ownerDocument, "h2", "Instancias");
  const instancesList = element(ownerDocument, "ul");
  instancesList.setAttribute("aria-label", "Instancias de Meeko");
  instancesSection.append(instancesTitle, instancesList);
  const detailSection = element(ownerDocument, "section", undefined, "detail");
  detailSection.id = "meeko-devtools-detail";
  detailSection.setAttribute("aria-label", "Detalle de instancia");
  main.append(instancesSection, detailSection);

  const eventsSection = element(ownerDocument, "section", undefined, "events");
  const eventsTitle = element(ownerDocument, "h2", "Eventos recientes");
  const eventsHead = element(ownerDocument, "div", undefined, "events-head");
  const signalFilterLabel = element(ownerDocument, "label", " Sólo señales");
  const signalFilter = element(ownerDocument, "input");
  signalFilter.type = "checkbox";
  signalFilter.setAttribute("aria-label", "Mostrar sólo eventos de señales");
  signalFilterLabel.prepend(signalFilter);
  eventsHead.append(eventsTitle, signalFilterLabel);
  const eventsList = element(ownerDocument, "ol");
  eventsList.setAttribute("aria-label", "Eventos recientes de Meeko");
  eventsSection.append(eventsHead, eventsList);
  const status = element(ownerDocument, "div", undefined, "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(header, mobileSwitch, main, eventsSection, status);
  shadow.append(style, panel);
  container.appendChild(host);

  let hook: DevtoolsHook | undefined;
  let unsubscribe: (() => void) | undefined;
  let highlightedId: string | null = null;
  let mounted = true;
  let mobileView: "instances" | "detail" = "instances";

  /** Cambia la vista móvil y comunica el botón activo a tecnologías de asistencia. */
  function showMobileView(next: "instances" | "detail"): void {
    mobileView = next;
    main.dataset.view = mobileView;
    instancesButton.setAttribute("aria-pressed", String(mobileView === "instances"));
    detailButton.setAttribute("aria-pressed", String(mobileView === "detail"));
  }

  showMobileView(mobileView);
  instancesButton.addEventListener("click", () => showMobileView("instances"));
  detailButton.addEventListener("click", () => showMobileView("detail"));

  /** Conserva el foco al reconstruir una fila después de recibir una notificación. */
  function restoreFocus(id: string | undefined, action: string | undefined): void {
    if (!id || !action) return;
    for (const button of shadow.querySelectorAll<HTMLButtonElement>("button[data-instance-id]")) {
      if (button.dataset.instanceId === id && button.dataset.action === action) {
        button.focus();
        break;
      }
    }
  }

  /** Reconstruye sólo el contenido variable usando nodos de texto seguros. */
  function render(): void {
    if (!mounted) return;
    const active = shadow.activeElement as HTMLButtonElement | null;
    const focusId = active?.dataset.instanceId;
    const focusAction = active?.dataset.action;
    instancesList.replaceChildren();
    detailSection.replaceChildren();
    eventsList.replaceChildren();
    if (!hook) {
      status.textContent = "Hook no disponible. Abre una página Meeko con Vite en desarrollo y pulsa Actualizar.";
      instancesList.append(element(ownerDocument, "li", "No hay instancias disponibles.", "muted"));
      detailSection.append(element(ownerDocument, "p", "El runtime de desarrollo aún no está conectado."));
      eventsList.append(element(ownerDocument, "li", "Sin eventos.", "muted"));
      return;
    }

    let snapshot: ReturnType<DevtoolsHook["snapshot"]>;
    try {
      snapshot = hook.snapshot();
    } catch (error) {
      status.textContent = `No se pudo leer el hook: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    status.textContent = `${snapshot.instances.length} instancia(s) · ${snapshot.events.length} evento(s)`;
    if (snapshot.instances.length === 0) instancesList.append(element(ownerDocument, "li", "No hay componentes hidratados.", "muted"));
    const byId = new Map(snapshot.instances.map((instance) => [instance.id, instance]));
    const rendered = new Set<string>();
    function appendInstance(instance: DevtoolsInstance, list: HTMLUListElement): void {
      if (rendered.has(instance.id)) return;
      rendered.add(instance.id);
      const row = element(ownerDocument, "li", undefined, "tree-node");
      const selectButton = element(ownerDocument, "button", instance.name || instance.componentId);
      selectButton.type = "button";
      selectButton.title = `${instance.name} · ${instance.file}`;
      selectButton.setAttribute("aria-label", `Seleccionar ${instance.name || instance.componentId}`);
      selectButton.dataset.instanceId = instance.id;
      selectButton.dataset.action = "select";
      selectButton.setAttribute("aria-pressed", String(snapshot.selectedId === instance.id));
      selectButton.addEventListener("click", () => {
        hook?.select(instance.id);
        showMobileView("detail");
        render();
        if (view.matchMedia("(max-width: 540px)").matches) detailButton.focus();
      });
      row.append(selectButton);
      list.append(row);
      const children = instance.childIds.map((id) => byId.get(id)).filter((child): child is DevtoolsInstance => child !== undefined);
      if (children.length > 0) {
        const nested = element(ownerDocument, "ul", undefined, "tree-children");
        for (const child of children) appendInstance(child, nested);
        if (nested.childElementCount > 0) row.append(nested);
      }
    }
    for (const instance of snapshot.instances) if (!instance.parentId || !byId.has(instance.parentId)) appendInstance(instance, instancesList);
    for (const instance of snapshot.instances) appendInstance(instance, instancesList);

    const selected = snapshot.instances.find((instance: DevtoolsInstance) => instance.id === snapshot.selectedId);
    if (selected) {
      detailSection.append(element(ownerDocument, "h2", selected.name || selected.componentId));
      detailSection.append(element(ownerDocument, "p", selected.file, "path"));
      detailSection.append(element(ownerDocument, "p", `ID: ${selected.id} · Estado: ${selected.status === "hydrated" ? "Hidratado" : selected.status} · Padre: ${selected.parentId ?? "ninguno"} · Hijos: ${selected.childIds.length}`));
      const actions = element(ownerDocument, "div", undefined, "actions");
      const highlightButton = element(ownerDocument, "button", highlightedId === selected.id ? "Quitar resaltado" : "Resaltar en página");
      highlightButton.type = "button";
      highlightButton.setAttribute("aria-pressed", String(highlightedId === selected.id));
      highlightButton.dataset.instanceId = selected.id;
      highlightButton.dataset.action = "highlight";
      highlightButton.addEventListener("click", () => {
        highlightedId = highlightedId === selected.id ? null : selected.id;
        hook?.highlight(highlightedId);
        render();
      });
      const breakpointButton = element(ownerDocument, "button", selected.breakpoint ? "Desactivar punto de parada" : "Activar punto de parada");
      breakpointButton.type = "button";
      breakpointButton.setAttribute("aria-pressed", String(selected.breakpoint));
      breakpointButton.dataset.instanceId = selected.id;
      breakpointButton.dataset.action = "breakpoint";
      breakpointButton.addEventListener("click", () => {
        hook?.setBreakpoint(selected.id, !selected.breakpoint);
        render();
      });
      actions.append(highlightButton, breakpointButton);
      detailSection.append(actions, element(ownerDocument, "h3", "Props"), element(ownerDocument, "pre", formatValue(selected.props)), element(ownerDocument, "h3", "Señales"), element(ownerDocument, "pre", formatValue(selected.signals)));
    } else {
      detailSection.append(element(ownerDocument, "p", "Selecciona una instancia para ver props y señales."));
    }

    const recent = snapshot.events.filter((event) => !signalFilter.checked || event.kind === "signal").slice(-30).reverse();
    if (recent.length === 0) eventsList.append(element(ownerDocument, "li", "Sin eventos.", "muted"));
    for (const event of recent) {
      const row = element(ownerDocument, "li");
      const instance = byId.get(event.instanceId);
      const label = eventLabel(event);
      if (instance) {
        const button = element(ownerDocument, "button", label, "event-button");
        button.type = "button";
        button.dataset.instanceId = instance.id;
        button.dataset.action = "event";
        button.addEventListener("click", () => {
          hook?.select(instance.id);
          showMobileView("detail");
          render();
        });
        row.append(button);
      } else {
        row.textContent = label;
      }
      if (event.kind === "signal" && event.reads?.length) {
        const sites = element(ownerDocument, "details", undefined, "event-reads");
        sites.append(element(ownerDocument, "summary", `${event.reads.length} expresión(es) que dependen de la señal`));
        const list = element(ownerDocument, "ul");
        for (const read of event.reads) {
          const usage = element(ownerDocument, "li");
          usage.append(element(ownerDocument, "code", `${read.file}:${read.line}:${read.column}`), element(ownerDocument, "span", ` ${read.kind}: `), element(ownerDocument, "code", read.expression));
          list.append(usage);
        }
        sites.append(list);
        row.append(sites);
      }
      eventsList.append(row);
    }
    restoreFocus(focusId, focusAction);
  }

  /** Descubre el hook al inicio, al recibir el evento de disponibilidad o al pulsar Actualizar. */
  function connect(): void {
    if (!mounted) return;
    const next = (view as Window & { __MEEKO_DEVTOOLS__?: DevtoolsHook }).__MEEKO_DEVTOOLS__;
    if (next !== hook) {
      unsubscribe?.();
      hook = next;
      unsubscribe = hook?.subscribe(render);
    }
    render();
  }

  function unmount(): void {
    if (!mounted) return;
    mounted = false;
    unsubscribe?.();
    view.removeEventListener("meeko:devtools-ready", connect);
    refreshButton.removeEventListener("click", connect);
    closeButton.removeEventListener("click", unmount);
    if (highlightedId) hook?.highlight(null);
    host.remove();
    hook = undefined;
  }

  view.addEventListener("meeko:devtools-ready", connect);
  signalFilter.addEventListener("change", render);
  refreshButton.addEventListener("click", connect);
  closeButton.addEventListener("click", unmount);
  connect();
  return { refresh: connect, unmount };
}
