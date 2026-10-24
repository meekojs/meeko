/** A route manifest is shared by the server renderer and browser navigator. */
export interface RouteRecord {
  readonly id: string;
  readonly file: string;
  readonly layouts: readonly string[];
  readonly error?: string;
  readonly sidecar?: string;
}

export interface RouteMatch {
  readonly route: RouteRecord;
  readonly params: Readonly<Record<string, string>>;
}

type Segment = { kind: "static" | "param" | "rest"; value: string };

function segments(id: string): Segment[] {
  if (!id.startsWith("/")) throw new TypeError(`Route must start with /: ${id}`);
  return id.split("/").slice(1).filter(Boolean).map((part, index, all) => {
    if (/^\[\.\.\.[A-Za-z_$][\w$]*\]$/.test(part)) {
      if (index !== all.length - 1) throw new TypeError(`Catch-all must be final: ${id}`);
      return { kind: "rest", value: part.slice(4, -1) };
    }
    if (/^\[[A-Za-z_$][\w$]*\]$/.test(part)) return { kind: "param", value: part.slice(1, -1) };
    if (part.includes("[") || part.includes("]")) throw new TypeError(`Invalid route segment: ${part}`);
    return { kind: "static", value: part };
  });
}

function rank(id: string): number[] {
  return segments(id).map((part) => part.kind === "static" ? 3 : part.kind === "param" ? 2 : 1);
}

function compareRoute(a: RouteRecord, b: RouteRecord): number {
  const left = rank(a.id);
  const right = rank(b.id);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const score = (right[index] ?? 0) - (left[index] ?? 0);
    if (score) return score;
  }
  return a.id.localeCompare(b.id);
}

function collisionKey(id: string): string {
  return segments(id).map((part) => part.kind === "static" ? part.value : part.kind === "param" ? "[]" : "[...]").join("/");
}

function decodePart(part: string): string | undefined {
  try {
    const value = decodeURIComponent(part);
    return value.includes("/") || value.includes("\\") || value === "." || value === ".." ? undefined : value;
  } catch {
    return undefined;
  }
}

/** Validates collisions before sorting static routes ahead of parameters. */
export function createRouteManifest(routes: readonly RouteRecord[]): readonly RouteRecord[] {
  const keys = new Map<string, string>();
  for (const route of routes) {
    const key = collisionKey(route.id);
    const previous = keys.get(key);
    if (previous) throw new Error(`Route collision: ${previous} and ${route.file} both resolve to ${key || "/"}`);
    keys.set(key, route.file);
  }
  return Object.freeze([...routes].sort(compareRoute));
}

/** Resolves a URL against the same manifest used for SSR and client navigation. */
export function matchRoute(routes: readonly RouteRecord[], pathname: string): RouteMatch | undefined {
  if (!pathname.startsWith("/")) return undefined;
  const raw = pathname.split("/").slice(1).filter(Boolean);
  const path = raw.map(decodePart);
  if (path.some((part) => part === undefined)) return undefined;
  for (const route of routes) {
    const pattern = segments(route.id);
    const params: Record<string, string> = {};
    let index = 0;
    let matched = true;
    for (const part of pattern) {
      if (part.kind === "rest") {
        if (index === path.length) { matched = false; break; }
        params[part.value] = path.slice(index).join("/");
        index = path.length;
        break;
      }
      const value = path[index++];
      if (value === undefined || (part.kind === "static" && part.value !== value)) { matched = false; break; }
      if (part.kind === "param") params[part.value] = value;
    }
    if (matched && index === path.length) return { route, params };
  }
  return undefined;
}

/** Builds a URL from a manifest route and rejects absent or extra parameters. */
export function href(routes: readonly RouteRecord[], id: string, options: {
  params?: Readonly<Record<string, string>>;
  search?: Readonly<Record<string, string | number | boolean | null | undefined>>;
} = {}): string {
  if (!routes.some((route) => route.id === id)) throw new Error(`Unknown route: ${id}`);
  const params = options.params ?? {};
  const used = new Set<string>();
  const path = segments(id).map((part) => {
    if (part.kind === "static") return encodeURIComponent(part.value);
    const value = params[part.value];
    if (!value) throw new Error(`Missing route parameter: ${part.value}`);
    used.add(part.value);
    if (part.kind === "rest") {
      const pieces = value.split("/");
      if (pieces.some((piece) => !piece || piece === "." || piece === "..")) throw new Error(`Invalid catch-all parameter: ${part.value}`);
      return pieces.map(encodeURIComponent).join("/");
    }
    if (value.includes("/") || value === "." || value === "..") throw new Error(`Invalid route parameter: ${part.value}`);
    return encodeURIComponent(value);
  });
  for (const key of Object.keys(params)) if (!used.has(key)) throw new Error(`Unknown route parameter: ${key}`);
  const url = new URL(path.length ? `/${path.join("/")}` : "/", "http://meeko.local");
  for (const [key, value] of Object.entries(options.search ?? {})) if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  return url.pathname + url.search;
}

export interface NavigationContext {
  readonly url: URL;
  readonly match: RouteMatch;
  readonly signal: AbortSignal;
  /** Longest prefix shared with the previous route's layout chain. */
  readonly retainedLayouts: number;
}

export interface Navigator {
  navigate(to: string, options?: { replace?: boolean }): Promise<boolean>;
  dispose(): void;
}

/**
 * The host owns actual DOM outlet rendering. Its callback receives layout
 * identity so it can retain matching layout instances and release exited ones.
 */
export function createNavigator(routes: readonly RouteRecord[], render: (context: NavigationContext) => Promise<void> | void, browser: Window = window): Navigator {
  let current = matchRoute(routes, browser.location.pathname);
  let pending: AbortController | undefined;
  let disposed = false;
  const navigate = async (to: string, options: { replace?: boolean } = {}): Promise<boolean> => {
    if (disposed) throw new Error("Navigator disposed");
    const url = new URL(to, browser.location.href);
    if (url.origin !== browser.location.origin) throw new TypeError("External navigation is not a Meeko route");
    const match = matchRoute(routes, url.pathname);
    if (!match) return false;
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    let retainedLayouts = 0;
    if (current) {
      while (current.route.layouts[retainedLayouts] === match.route.layouts[retainedLayouts]
        && retainedLayouts < current.route.layouts.length
        && retainedLayouts < match.route.layouts.length) retainedLayouts++;
    }
    await render({ url, match, signal: controller.signal, retainedLayouts });
    if (controller.signal.aborted || disposed) return false;
    if (options.replace) browser.history.replaceState(null, "", url);
    else browser.history.pushState(null, "", url);
    current = match;
    pending = undefined;
    return true;
  };
  const onPop = () => {
    void navigate(browser.location.href, { replace: true });
  };
  browser.addEventListener("popstate", onPop);
  return {
    navigate,
    dispose() {
      disposed = true;
      pending?.abort();
      browser.removeEventListener("popstate", onPop);
    },
  };
}
