---
source-hash: aecbb92ab337d41f6b992768ced5e900902f22ead98aabbae84455b642a222ce
---

# Common decisions in Meeko

This guide covers decisions that come up while building an application: where to put a route, how to load data, and when to use API, RPC or Socket. Start with [your first application](primeros-pasos.md) if you do not have a project yet, and use the [reference](/en/docs/reference) for each API's contracts and options.

To learn how to connect pages, data and layouts, follow [Router: pages and navigation](router.md).

## Pages and server code

| You need                               | Start with                                                  | Use the other form when                                                                     |
| -------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Declare the route alongside its page   | `export const route = definePage(...)` in `<script server>` | A `*.route.ts` sidecar keeps extensive server logic separate.                               |
| Share options across a group of pages  | `+group.ts` with `defineGroup`                              | Each page needs its own options or data.                                                    |
| Run code during SSR inside a component | `<script>`                                                  | The code is specific to the request and belongs in a page's `<script server>` or a sidecar. |

`<script server>` and `*.route.ts` are two locations for the same route contract. Choose **one per page**: declaring both causes discovery to report a conflict. The server block is limited to pages in `app/pages`; `render: "client"` changes its runtime environment and sends it to the browser. Before using secrets, review the [execution boundary](reference/syntax/script-server.md) and [rendering modes](framework.md#rendering-modes).

## Data and loading

| You need                                       | Start with                                                               | What happens                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Essential data in the initial HTML             | A `definePage` loader or top-level code in `<script server>`             | The page waits for the data before rendering.                                    |
| Component data available in SSR                | `await useApi(...)` or `await useRpcQuery(...)`                          | The query participates in the initial render.                                    |
| Secondary data after the first render          | `useApi(...)` or `useRpcQuery(...)` without `await`, with `<MeekoAwait>` | The component displays loading, data or error without delaying the first render. |
| Deliver part of the data later from the server | `render: "stream"` and `defer(...)`                                      | The server sends the page and then the deferred value.                           |

`<MeekoAwait>` represents resource states: it does not create another transport. See [MeekoAwait](reference/components/meekoawait.md), [data in components](framework.md#data-in-components-useapi-userpcquery-and-userpcmutation) and [streaming SSR](framework.md#streaming-ssr-render-stream).

## API, RPC and Socket

| You need                                                           | Choose                | Reason                                               |
| ------------------------------------------------------------------ | --------------------- | ---------------------------------------------------- |
| A public HTTP URL, webhook or contract for another client          | `defineApiRoute`      | The endpoint preserves HTTP semantics.               |
| An internal typed operation between the application and its server | `defineRpc`           | The client calls an operation from the RPC registry. |
| Messages that arrive without a new request                         | `defineSocketChannel` | Persistent real-time communication.                  |

API and RPC share contract validation and server checks. The client's TypeScript type does not validate external data by itself: declare input and output schemas where appropriate. See [API and RPC](framework.md#api-and-rpc), [defineApiRoute](reference/macros/defineapiroute.md) and [defineRpc](reference/macros/definerpc.md).

## Values in the template

| You need                                                     | Choose                                    | Direction                                    |
| ------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------- |
| Computed text between tags                                   | `{expression}`                            | Read.                                        |
| A computed HTML attribute or prop                            | `bind:name="expression"`                  | From the parent to the element or component. |
| An editable control value or a model declared by a component | `model="signal"` or `model:name="signal"` | Read and write a signal.                     |
| Respond to an event                                          | `on:name="handler"`                       | The event calls the handler.                 |

`bind:` does not turn an expression into a two-way binding. If you have a signal, read its value: `bind:disabled="saving.value"`; passing `saving` passes the signal object. `model` requires a writable signal, and the child component must declare its model with `defineModel`. See [bind](reference/syntax/bind.md), [model](reference/syntax/model.md) and [on](reference/syntax/on.md).

## Components by name

Use a component tag when its identity is known in the template. If it is chosen at runtime, use `<component is>` with a renderable component. If the name comes from the [component registry](framework.md#auto-imports-and-typescript), load it through the registry helper before rendering. `<component is>` also accepts dynamic HTML tags; in that case, attributes are applied according to the selected tag. Read [component is](reference/components/component-tag.md) before combining HTML tags with different attributes.

## Auto-imports and scopes

The available symbols depend on the location: `<script>`, `<script server>`, `app/`, `shared/` and `server/` do not have the same environment. A server file is not sent to the browser just because it appears in an SSR page. If a name has more than one source, resolve the ambiguity explicitly. The [auto-import guide](framework.md#auto-imports-and-typescript) describes folders, scopes, precedence and generated declarations; [where each API is used](framework.md#where-each-api-is-used) summarizes the boundaries.

## Keep learning

- [Your first application](primeros-pasos.md): a runnable walkthrough with the starter.
- [Full-stack framework](framework.md): configuration, routes, resources, security and deployment.
- [Components and API](api.md): `.meeko` syntax and component contracts.
- [Reference](/en/docs/reference): details of each symbol and its examples.
