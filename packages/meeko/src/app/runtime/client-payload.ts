import type { PageHead, PageRender } from "../definitions/define-page";
import type { PayloadDeferred } from "./client-deferred";

import { PAYLOAD_VERSION, payloadHead } from "../definitions/define-page";
import { isRecord, readDeferredEntries } from "./client-deferred";

export interface HydrationPayload {
  /** Empty in an application error page payload (`error: true`), which has no route. */
  route: string;
  /** The payload renders `app/error.meeko` for a URL without a route; props are `{ status, message }`. */
  error: boolean;
  render: PageRender;
  props: Record<string, unknown>;
  state: Record<string, unknown>;
  sharedState: Record<string, unknown>;
  head: PageHead;
  deferred: readonly PayloadDeferred[];
  /** Data of the top-level data awaits that the server rendered, by request key. */
  resources: Record<string, unknown>;
  /** Props the named layout rendered with, when the page has one. */
  layoutProps: Record<string, unknown> | undefined;
  /**
   * The URL the server rendered (path and query), when the payload says it. A prerendered page or
   * the `404.html` of a static host may be served under another URL.
   */
  url: string | undefined;
}

const pageRenders: readonly string[] = ["ssr", "stream", "prerender", "client"] satisfies readonly PageRender[];

export function readPayload(value: unknown): HydrationPayload {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (isRecord(parsed) && parsed.v !== PAYLOAD_VERSION) {
    throw new TypeError(`Unsupported Meeko payload version ${String(parsed.v)}; the server and browser bundles must come from the same build`);
  }
  const error = isRecord(parsed) && parsed.error === true;
  if (!isRecord(parsed) || (!error && typeof parsed.route !== "string") || !isRecord(parsed.props) || !isRecord(parsed.state)) {
    throw new TypeError("Invalid Meeko hydration payload");
  }
  if (error) {
    if (typeof parsed.props.status !== "number" || !Number.isInteger(parsed.props.status) || typeof parsed.props.message !== "string") {
      throw new TypeError("Invalid Meeko error page props");
    }
  } else if (!isRecord(parsed.props.params) || !isRecord(parsed.props.search)) throw new TypeError("Invalid Meeko route props");
  if (parsed.sharedState !== undefined && !isRecord(parsed.sharedState)) throw new TypeError("Invalid Meeko shared state");
  if (parsed.resources !== undefined && !isRecord(parsed.resources)) throw new TypeError("Invalid Meeko page data");
  if (parsed.layoutProps !== undefined && !isRecord(parsed.layoutProps)) throw new TypeError("Invalid Meeko layout props");
  // A path and its query, as the server saw them: never another origin nor a fragment.
  if (parsed.url !== undefined && (typeof parsed.url !== "string" || !parsed.url.startsWith("/") || parsed.url.includes("#"))) {
    throw new TypeError("Invalid Meeko payload URL");
  }
  const render = parsed.render ?? "ssr";
  if (typeof render !== "string" || !pageRenders.includes(render) || (error && render !== "ssr")) throw new TypeError("Invalid Meeko page render mode");
  let head: PageHead;
  try { head = payloadHead((parsed.head ?? {}) as PageHead); }
  catch (cause) { throw new TypeError("Invalid Meeko page head", { cause }); }
  return {
    route: error ? "" : parsed.route as string, error, render: render as PageRender, props: parsed.props, state: parsed.state,
    sharedState: parsed.sharedState ?? {}, head,
    deferred: readDeferredEntries(parsed.deferred),
    resources: (parsed.resources as Record<string, unknown> | undefined) ?? {},
    layoutProps: parsed.layoutProps as Record<string, unknown> | undefined,
    url: parsed.url as string | undefined,
  };
}

