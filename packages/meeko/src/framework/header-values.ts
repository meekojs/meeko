const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const headerValue = /^[^\u0000-\u0008\u000a-\u001f\u007f]*$/;

/** Checks the names and values of some response headers, with `file` and `label` in the message. */
export function validateHeaderValues(headers: Record<string, unknown>, label: string, file: string): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!headerName.test(name)) throw new TypeError(`${file}: ${label} tiene un nombre de cabecera no válido ${JSON.stringify(name)}`);
    if (name.toLowerCase() === "content-security-policy") throw new TypeError(`${file}: ${label} no puede fijar Content-Security-Policy; use server.contentSecurityPolicy, que añade los hashes de los scripts`);
    if (typeof value !== "string" || !headerValue.test(value)) throw new TypeError(`${file}: ${label}.${name} debe ser una cadena sin saltos de línea`);
  }
}
