/**
 * The state a native form submission leaves for the page it returns to (Meeko 1.7). An API route
 * with `form` answers a `<form method="post">` without JavaScript with a `303` and a single-use
 * cookie; the server reads it while it renders that page and `useForm({ action })` shows it. The
 * state travels to the browser in the page state, so hydration paints the same thing.
 *
 * Browser-safe: no server import. The server side lives in `framework-server/forms.ts`.
 */
import { createContext } from "../reactivity.js";
import type { ValidationIssue } from "./clients.js";

/** What a native submission of the form of `action` left: its outcome and, on failure, its messages. */
export interface FormFlash {
  /** Pathname of the API route the form was sent to, such as `/api/feedback`. */
  readonly action: string;
  /** Whether the submission ended well. */
  readonly ok: boolean;
  /** Public error code of a failed submission. */
  readonly code?: string | undefined;
  /** HTTP status of a failed submission. */
  readonly status?: number | undefined;
  /** Request ID of a failed submission. */
  readonly requestId?: string | undefined;
  /** Field messages of a failed submission, as in a `400`. */
  readonly issues?: readonly ValidationIssue[] | undefined;
  /** Values the user sent, so the form shows them again (never files nor secrets). */
  readonly values?: Readonly<Record<string, unknown>> | undefined;
}

/** What the server publishes for `useForm` while it renders a page. */
export interface FormFlashSource {
  /** The flash of this request, if the browser came back from a native submission. */
  readonly flash: FormFlash | undefined;
  /** The CSRF token of the session, for the `_csrf` field of a native form. */
  readonly csrfToken: string | undefined;
}

/** Names of the one-time cookie of a native form: `__Host-` over HTTPS, so no subdomain can plant it. */
export const formFlashCookies = { secure: "__Host-meeko-form", plain: "meeko-form" } as const;

/** Published by the server's built-in form plugin during each page render. */
export const formFlashKey = /*#__PURE__*/ createContext<FormFlashSource>("Meeko native forms");

/** Key of the page state that carries the flash of `action` to the browser. */
export function formStateKey(action: string): string {
  return `meeko:form:${action}`;
}

/** The pathname of an action such as `/api/feedback?x=1#y`. */
export function actionPathname(action: string): string {
  const end = action.search(/[?#]/);
  return end === -1 ? action : action.slice(0, end);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

/** Checks a flash read from a cookie or from the page state; anything malformed is ignored. */
export function parseFormFlash(value: unknown): FormFlash | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.action !== "string" || !raw.action.startsWith("/") || typeof raw.ok !== "boolean") return undefined;
  const flash: { -readonly [K in keyof FormFlash]: FormFlash[K] } = { action: raw.action, ok: raw.ok };
  if (typeof raw.code === "string") flash.code = raw.code;
  if (typeof raw.status === "number" && Number.isInteger(raw.status)) flash.status = raw.status;
  if (typeof raw.requestId === "string") flash.requestId = raw.requestId;
  if (Array.isArray(raw.issues)) {
    flash.issues = raw.issues.filter((issue: unknown): issue is ValidationIssue => issue !== null && typeof issue === "object"
      && typeof (issue as { path?: unknown }).path === "string" && typeof (issue as { message?: unknown }).message === "string")
      .map(({ path, message }) => ({ path, message }));
  }
  if (raw.values !== null && typeof raw.values === "object" && !Array.isArray(raw.values)) {
    // A null prototype: a `__proto__` key in the cookie or the state is a field, never a prototype.
    const values: Record<string, unknown> = Object.create(null);
    for (const [key, entry] of Object.entries(raw.values as Record<string, unknown>)) {
      if (isScalar(entry) || (Array.isArray(entry) && entry.every(isScalar))) values[key] = entry;
    }
    flash.values = values;
  }
  return flash;
}
