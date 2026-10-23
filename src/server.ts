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

function assertSerializable(value: unknown, path: string, ancestors: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError(`Non-finite number at ${path}`);
  }
  if (typeof value !== "object") throw new TypeError(`Non-serializable value at ${path}`);
  if (ancestors.has(value)) throw new TypeError(`Circular reference at ${path}`);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Non-plain object at ${path}`);
  }
  if (Object.hasOwn(value, "toJSON")) throw new TypeError(`Custom toJSON at ${path}`);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`Sparse array at ${path}[${index}]`);
    }
  }
  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`Symbol key at ${path}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) continue;
      if (!("value" in descriptor)) throw new TypeError(`Accessor property at ${path}.${key}`);
      assertSerializable(descriptor.value, `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

/** Serializa estado y props transferibles al navegador, rechazando valores ambiguos. */
export function serializeJson(value: unknown): string {
  assertSerializable(value, "$", new WeakSet());
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Value cannot be serialized to JSON");
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
