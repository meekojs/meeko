/** Escapa texto dinámico antes de insertarlo en HTML generado por SSR. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const booleanAttributes = new Set(["allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected"]);

/** Convierte un valor de atributo dinámico en su forma DOM; null lo elimina. */
export function attributeValue(name: string, value: unknown): string | null {
  if (booleanAttributes.has(name)) return value ? "" : null;
  if (value === null || value === undefined || value === false) return null;
  return String(value);
}

/** Genera un atributo HTML dinámico con escape seguro para SSR. */
export function renderAttribute(name: string, value: unknown): string {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(name)) throw new TypeError(`Invalid attribute name: ${name}`);
  const resolved = attributeValue(name, value);
  return resolved === null ? "" : ` ${name}="${escapeHtml(resolved)}"`;
}

/** Serializa datos iniciales para un bloque JSON dentro del HTML de SSR. */
export function serializeJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Value cannot be serialized to JSON");
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
