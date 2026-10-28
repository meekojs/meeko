/**
 * `POST /_meeko/theme`: the form of `<MeekoThemeToggle>` without JavaScript. It changes the theme
 * cookie and sends the browser back to the page with a `303`, so the next SSR document already has
 * the new theme. Server code only: the browser bundle never imports it.
 */
import { isThemeChoice } from "./theme.js";
import type { ResolvedThemeConfig } from "./theme.js";

/** The form has two short fields; anything longer is not that form. */
const maxBodyBytes = 2048;

const year = 60 * 60 * 24 * 365;

function plain(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });
}

/** The body as text, or `undefined` when it is longer than `limit` bytes. */
async function boundedText(request: Request, limit: number): Promise<string | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/**
 * The page to return to: a path of this origin (`/docs?tab=a`), never another site. A protocol-relative
 * `//evil.example`, a backslash that browsers read as a slash, an absolute URL or control characters
 * are not a path of this origin, so they go back to `/`.
 */
export function themeReturnPath(value: string | null, origin: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  let target: URL;
  try { target = new URL(value, origin); }
  catch { return "/"; }
  return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : "/";
}

/**
 * Handles `POST /_meeko/theme` (`theme` and `return`, as a urlencoded form). It does not use the
 * session nor the CSRF token: it reads and writes only the theme cookie. Like `origin: "required"`
 * of an API route, it accepts only the request's own `Origin` (the public origin behind
 * `createServerApp`), which browsers send with every `POST`, so another site cannot change the theme
 * nor use the redirect. The theme must be one of `themes` or `"system"`; the cookie is the one the
 * browser runtime writes.
 */
export async function themeEndpoint(config: ResolvedThemeConfig, request: Request): Promise<Response> {
  if (request.method !== "POST") return plain(405, "Method Not Allowed", { allow: "POST" });
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return plain(403, "INVALID_ORIGIN");
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return plain(415, "Unsupported Media Type");
  const body = await boundedText(request, maxBodyBytes);
  if (body === undefined) return plain(413, "Payload Too Large");
  const form = new URLSearchParams(body);
  const theme = form.get("theme");
  if (!isThemeChoice(config, theme)) return plain(400, "INVALID_THEME");
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      location: themeReturnPath(form.get("return"), url.origin),
      "set-cookie": `${config.cookie}=${encodeURIComponent(theme)}; Path=/; Max-Age=${year}; SameSite=Lax${secure}`,
      "cache-control": "no-store",
    },
  });
}
