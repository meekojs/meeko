---
source-hash: 8616f075e0096822087fb75238824c77ff9b35c808a6bd1b4364abc2d7c89f2c
---


# Meeko as a full-stack framework

A Meeko application organizes pages in `app/pages`, components in `app/components`, and endpoints in `server/`. The framework discovers those folders, renders pages on the server by default, and generates the required entries and types. If you do not have a project yet, start with [Create an application](#create-an-application).

For example, `app/pages/index.meeko` is already the `/` route:

```meeko
<script lang="ts">
	const count = signal(0)
</script>

<template>
	<main>
		<h1>Hello, Meeko</h1>
		<button on:click="() => count.value++">Local visits: {count.value}</button>
	</main>
</template>
```

`signal` is auto-imported in application components. The server sends the initial HTML, and the browser hydrates the button. For a page with data, continue with [Page server code](#page-server-code) or [Data in components](#data-in-components-useapi-userpcquery-and-userpcmutation). For HTTP or RPC calls, see [API and RPC](#api-and-rpc). Configuration, migrations, and adapters follow this initial walkthrough.

## Create an application

From a clean directory, with Node.js 24+ and npm, run:

```sh
npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init-framework my-app
cd my-app
npm install
npm run dev
```

The starter creates `meeko.config.ts`, `app/app.meeko`, `app/pages`, `app/styles/main.css`, a layout with an outlet and an `.env.example` with Meeko's variables; it does not need `server/runtime.ts`, because sessions work without configuration (see [Authentication](#authentication)). Meeko generates client/server entry points and their build configurations under `.meeko/`; you run `meeko dev`, `meeko check`, `meeko build` and `meeko start` through the `package.json` scripts; `meeko preview` also runs the build. You can organize the application like this:

```text
app/{pages,layouts,middleware,components,composables,utils,stores,styles}/
server/{api,rpc,socket,middleware,utils}/
shared/{types,schemas,utils,constants,enums}/
layers/base/app/pages/
modules/auth/app/pages/
public/
meeko.config.ts
tsconfig.json
.meeko/{types,manifests,generated,output}/
```

Meeko generates Vite entry points and per-scope TypeScript configurations only under `.meeko/`. The single root `tsconfig.json` connects VS Code to these generated projects to preserve diagnostics and completion in `.ts` files. The optional `server/runtime.ts` is application code: it declares services, Socket policy and, if Meeko's sessions are not enough, your own sessions. The standalone engine starter remains available with `meeko init <directory>`.

## Guides by task

For routing tasks, start with [Routing](routing.md) and its guides to pages, data, layouts, navigation and middleware.

- [Configuration, layers, modules, auto-imports, aliases and migration](framework-configuration.md)
- [Routing, SSR, layouts, head, theme and middleware](framework-rendering.md)
- [HTTP and RPC contracts, data and forms](framework-api.md)
- [Connections, contracts and broadcast](framework-websocket.md)
- [Runtime, services and error handling](framework-server.md)
- [Authentication, passwords, sessions and security](framework-auth.md)
- [Build, adapters, deployment and performance](framework-deployment.md)
- [Subpaths, targets, compatibility and limits](framework-reference.md)

## Previous links

These links preserve published anchors and point to their new sections:

<a id="configuration"></a>[Configuration](framework-configuration.md#configuration)

<a id="server-logs-in-the-browser-console"></a>[Server logs in the browser console](framework-configuration.md#server-logs-in-the-browser-console)

<a id="routing-layouts-and-ssr"></a>[Routing, layouts and SSR](framework-rendering.md#routing-layouts-and-ssr)

<a id="meekooutlet--and-meekolink"></a>[<MeekoOutlet /> and <MeekoLink>](framework-rendering.md#meekooutlet--and-meekolink)

<a id="meekoteleport"></a>[<MeekoTeleport>](framework-rendering.md#meekoteleport)

<a id="named-layouts"></a>[Named layouts](framework-rendering.md#named-layouts)

<a id="per-folder-options-groupts"></a>[Per-folder options: +group.ts](framework-rendering.md#per-folder-options-groupts)

<a id="layouts-from-layers-and-modules"></a>[Layouts from layers and modules](framework-rendering.md#layouts-from-layers-and-modules)

<a id="layout-props-from-the-page"></a>[Layout props from the page](framework-rendering.md#layout-props-from-the-page)

<a id="application-error-page-apperrormeeko"></a>[Application error page (app/error.meeko)](framework-rendering.md#application-error-page-apperrormeeko)

<a id="page-server-code"></a>[Page server code](framework-rendering.md#page-server-code)

<a id="top-level-code-and-exported-data"></a>[Top-level code and exported data](framework-rendering.md#top-level-code-and-exported-data)

<a id="route-options-with-definepage"></a>[Route options with definePage](framework-rendering.md#route-options-with-definepage)

<a id="common-rules"></a>[Common rules](framework-rendering.md#common-rules)

<a id="where-each-api-can-be-used"></a>[Where each API can be used](framework-rendering.md#where-each-api-can-be-used)

<a id="rendering-modes"></a>[Rendering modes](framework-rendering.md#rendering-modes)

<a id="streaming-ssr-render-stream"></a>[Streaming SSR (render: "stream")](framework-rendering.md#streaming-ssr-render-stream)

<a id="ssr-page-caching"></a>[SSR page caching](framework-rendering.md#ssr-page-caching)

<a id="links-anchors-and-scrolling"></a>[Links, anchors and scrolling](framework-rendering.md#links-anchors-and-scrolling)

<a id="native-view-transitions"></a>[Native View Transitions](framework-rendering.md#native-view-transitions)

<a id="navigation-state"></a>[Navigation state](framework-rendering.md#navigation-state)

<a id="current-route"></a>[Current route](framework-rendering.md#current-route)

<a id="document-head-document-usehead-and-useseometa"></a>[Document head: document, useHead and useSeoMeta](framework-rendering.md#document-head-document-usehead-and-useseometa)

<a id="per-page-canonical-url-and-open-graph"></a>[Per-page canonical URL and Open Graph](framework-rendering.md#per-page-canonical-url-and-open-graph)

<a id="lightdark-theme-without-flashing"></a>[Light/dark theme without flashing](framework-rendering.md#lightdark-theme-without-flashing)

<a id="usetheme"></a>[useTheme()](framework-rendering.md#usetheme)

<a id="icons-that-do-not-shift"></a>[Icons that do not shift](framework-rendering.md#icons-that-do-not-shift)

<a id="data-theme-choice"></a>[data-theme-choice](framework-rendering.md#data-theme-choice)

<a id="custom-theme-selector"></a>[Custom theme selector](framework-rendering.md#custom-theme-selector)

<a id="meekothemetoggle"></a>[<MeekoThemeToggle>](framework-rendering.md#meekothemetoggle)

<a id="how-flashing-is-prevented-in-each-case"></a>[How flashing is prevented in each case](framework-rendering.md#how-flashing-is-prevented-in-each-case)

<a id="csp"></a>[CSP](framework-rendering.md#csp)

<a id="caching"></a>[Caching](framework-rendering.md#caching)

<a id="layers"></a>[Layers](framework-configuration.md#layers)

<a id="folders-in-modules-deprecated"></a>[Folders in modules (deprecated)](framework-configuration.md#folders-in-modules-deprecated)

<a id="modules"></a>[Modules](framework-configuration.md#modules)

<a id="option-types-without-imports"></a>[Option types without imports](framework-configuration.md#option-types-without-imports)

<a id="write-a-module"></a>[Write a module](framework-configuration.md#write-a-module)

<a id="the-meeko-object"></a>[The meeko object](framework-configuration.md#the-meeko-object)

<a id="hooks"></a>[Hooks](framework-configuration.md#hooks)

<a id="application-plugins"></a>[Application plugins](framework-configuration.md#application-plugins)

<a id="server-and-client-boundaries"></a>[Server and client boundaries](framework-configuration.md#server-and-client-boundaries)

<a id="route-and-server-middleware"></a>[Route and server middleware](framework-rendering.md#route-and-server-middleware)

<a id="named-middleware"></a>[Named middleware](framework-rendering.md#named-middleware)

<a id="server-route-middleware"></a>[Server route middleware](framework-rendering.md#server-route-middleware)

<a id="server-middleware"></a>[Server middleware](framework-rendering.md#server-middleware)

<a id="auto-imports-and-typescript"></a>[Auto-imports and TypeScript](framework-configuration.md#auto-imports-and-typescript)

<a id="auto-import-folders"></a>[auto-import-folders](framework-configuration.md#auto-import-folders)

<a id="folder-with-index"></a>[folder-with-index](framework-configuration.md#folder-with-index)

<a id="component-types"></a>[component-types](framework-configuration.md#component-types)

<a id="path-aliases"></a>[Path aliases](framework-configuration.md#path-aliases)

<a id="alias-scopes"></a>[Alias scopes](framework-configuration.md#alias-scopes)

<a id="custom-aliases-alias"></a>[Custom aliases: alias](framework-configuration.md#custom-aliases-alias)

<a id="aliases-in-layers"></a>[Aliases in layers](framework-configuration.md#aliases-in-layers)

<a id="alias-priority-and-conflicts"></a>[Alias priority and conflicts](framework-configuration.md#alias-priority-and-conflicts)

<a id="api-and-rpc"></a>[API and RPC](framework-api.md#api-and-rpc)

<a id="public-schemas"></a>[Public schemas](framework-api.md#public-schemas)

<a id="dynamic-segments-in-api"></a>[Dynamic segments in api.*](framework-api.md#dynamic-segments-in-api)

<a id="form-validation-errors"></a>[Form validation errors](framework-api.md#form-validation-errors)

<a id="field-errors-apierror-with-issues"></a>[Field errors: ApiError with issues](framework-api.md#field-errors-apierror-with-issues)

<a id="per-request-values-locals"></a>[Per-request values: locals](framework-api.md#per-request-values-locals)

<a id="response-status-status"></a>[Response status: status](framework-api.md#response-status-status)

<a id="forms-without-javascript-form"></a>[Forms without JavaScript: form](framework-api.md#forms-without-javascript-form)

<a id="data-in-components-useapi-userpcquery-and-userpcmutation"></a>[Data in components: useApi, useRpcQuery and useRpcMutation](framework-api.md#data-in-components-useapi-userpcquery-and-userpcmutation)

<a id="with-and-without-await"></a>[With and without await](framework-api.md#with-and-without-await)

<a id="ssr-and-hydration"></a>[SSR and hydration](framework-api.md#ssr-and-hydration)

<a id="navigation-and-render-client"></a>[Navigation and render: "client"](framework-api.md#navigation-and-render-client)

<a id="components-that-mount-later"></a>[Components that mount later](framework-api.md#components-that-mount-later)

<a id="previous-data-during-a-reload-keepprevious"></a>[Previous data during a reload: keepPrevious](framework-api.md#previous-data-during-a-reload-keepprevious)

<a id="search-as-you-type-debouncems-and-enabled"></a>[Search as you type: debounceMs and enabled](framework-api.md#search-as-you-type-debouncems-and-enabled)

<a id="meekoawait"></a>[<MeekoAwait>](framework-api.md#meekoawait)

<a id="reserve-height-reserve"></a>[Reserve height: reserve](framework-api.md#reserve-height-reserve)

<a id="an-optional-transition"></a>[An optional transition](framework-api.md#an-optional-transition)

<a id="prevent-layout-shifts-cls"></a>[Prevent layout shifts (CLS)](framework-api.md#prevent-layout-shifts-cls)

<a id="mutations"></a>[Mutations](framework-api.md#mutations)

<a id="retry-safe-mutations"></a>[Retry-safe mutations](framework-api.md#retry-safe-mutations)

<a id="per-attempt-notifications-onsuccess-and-onerror"></a>[Per-attempt notifications: onSuccess and onError](framework-api.md#per-attempt-notifications-onsuccess-and-onerror)

<a id="a-custom-key-in-api-and-rpc"></a>[A custom key in api.* and rpc.*](framework-api.md#a-custom-key-in-api-and-rpc)

<a id="load-or-composables"></a>[load or composables](framework-api.md#load-or-composables)

<a id="persistent-state-usestorage"></a>[Persistent state: useStorage](framework-api.md#persistent-state-usestorage)

<a id="forms-useform"></a>[Forms: useForm](framework-api.md#forms-useform)

<a id="focus-the-first-error"></a>[Focus the first error](framework-api.md#focus-the-first-error)

<a id="field-components-formfield"></a>[Field components: FormField](framework-api.md#field-components-formfield)

<a id="websocket"></a>[WebSocket](framework-websocket.md#websocket)

<a id="clients-with-explicit-urls-and-contracts"></a>[Clients with explicit URLs and contracts](framework-websocket.md#clients-with-explicit-urls-and-contracts)

<a id="broadcast-from-the-server"></a>[Broadcast from the server](framework-websocket.md#broadcast-from-the-server)

<a id="broadcast-and-multiple-instances"></a>[Broadcast and multiple instances](framework-websocket.md#broadcast-and-multiple-instances)

<a id="server-runtime"></a>[Server runtime](framework-server.md#server-runtime)

<a id="service-types"></a>[Service types](framework-server.md#service-types)

<a id="errors"></a>[Errors](framework-server.md#errors)

<a id="global-browser-failures"></a>[Global browser failures](framework-server.md#global-browser-failures)

<a id="failures-outside-a-request"></a>[Failures outside a request](framework-server.md#failures-outside-a-request)

<a id="authentication"></a>[Authentication](framework-auth.md#authentication)

<a id="session-types-meekosession"></a>[Session types: MeekoSession](framework-auth.md#session-types-meekosession)

<a id="passwords"></a>[Passwords](framework-auth.md#passwords)

<a id="rate-limiting-ratelimit"></a>[Rate limiting: rateLimit](framework-auth.md#rate-limiting-ratelimit)

<a id="sql-rate-limiting"></a>[SQL rate limiting](framework-auth.md#sql-rate-limiting)

<a id="client-ip-behind-a-proxy"></a>[Client IP behind a proxy](framework-auth.md#client-ip-behind-a-proxy)

<a id="cloudflare-tunnel-and-traefik"></a>[Cloudflare Tunnel and Traefik](framework-auth.md#cloudflare-tunnel-and-traefik)

<a id="sessions-and-security"></a>[Sessions and security](framework-auth.md#sessions-and-security)

<a id="sessions-without-configuration"></a>[Sessions without configuration](framework-auth.md#sessions-without-configuration)

<a id="session-duration"></a>[Session duration](framework-auth.md#session-duration)

<a id="origin-in-anonymous-mutations"></a>[Origin in anonymous mutations](framework-auth.md#origin-in-anonymous-mutations)

<a id="revocation-during-a-request"></a>[Revocation during a request](framework-auth.md#revocation-during-a-request)

<a id="clean-the-project"></a>[Clean the project](framework-configuration.md#clean-the-project)

<a id="build-deployment-and-verification"></a>[Build, deployment and verification](framework-deployment.md#build-deployment-and-verification)

<a id="static-site"></a>[Static site](framework-deployment.md#static-site)

<a id="sitemapxml-and-robotstxt"></a>[sitemap.xml and robots.txt](framework-deployment.md#sitemapxml-and-robotstxt)

<a id="dynamic-routes-in-the-sitemap-sitemapentries"></a>[Dynamic routes in the sitemap: sitemapEntries](framework-deployment.md#dynamic-routes-in-the-sitemap-sitemapentries)

<a id="sitemap-served-from-a-database"></a>[Sitemap served from a database](framework-deployment.md#sitemap-served-from-a-database)

<a id="csp-with-hashes"></a>[CSP with hashes](framework-deployment.md#csp-with-hashes)

<a id="csp-and-headers-in-server-adapters"></a>[CSP and headers in server adapters](framework-deployment.md#csp-and-headers-in-server-adapters)

<a id="bun"></a>[Bun](framework-deployment.md#bun)

<a id="deno"></a>[Deno](framework-deployment.md#deno)

<a id="cloudflare-workers"></a>[Cloudflare Workers](framework-deployment.md#cloudflare-workers)

<a id="sessions-in-d1"></a>[Sessions in D1](framework-deployment.md#sessions-in-d1)

<a id="redis-through-the-upstash-rest-api"></a>[Redis through the Upstash REST API](framework-deployment.md#redis-through-the-upstash-rest-api)

<a id="socket-and-durable-objects"></a>[Socket and Durable Objects](framework-deployment.md#socket-and-durable-objects)

<a id="adapter-conformance"></a>[Adapter conformance](framework-deployment.md#adapter-conformance)

<a id="troubleshoot-pnpm-and-redis"></a>[Troubleshoot pnpm and Redis](framework-deployment.md#troubleshoot-pnpm-and-redis)

<a id="performance-and-baseline"></a>[Performance and baseline](framework-deployment.md#performance-and-baseline)

<a id="project-setup-and-migration"></a>[Project setup and migration](framework-configuration.md#project-setup-and-migration)

<a id="migrate-an-earlier-full-stack-starter"></a>[Migrate an earlier full-stack starter](framework-configuration.md#migrate-an-earlier-full-stack-starter)

<a id="migrate-serversessionts-to-serverruntimets"></a>[Migrate server/session.ts to server/runtime.ts](framework-configuration.md#migrate-serversessionts-to-serverruntimets)

<a id="postcss-and-tailwind"></a>[postcss-and-tailwind](framework-configuration.md#postcss-and-tailwind)

<a id="generated-utilities-with-typescript"></a>[generated-utilities-with-typescript](framework-configuration.md#generated-utilities-with-typescript)

<a id="processed-global-stylesheet-for-the-editor"></a>[processed-global-stylesheet-for-the-editor](framework-configuration.md#processed-global-stylesheet-for-the-editor)

<a id="environment-variables-and-env"></a>[environment-variables-and-env](framework-configuration.md#environment-variables-and-env)

<a id="displayed-url"></a>[displayed-url](framework-configuration.md#displayed-url)

<a id="package-subpaths-and-runtimes"></a>[Package subpaths and runtimes](framework-reference.md#package-subpaths-and-runtimes)

<a id="compatibility-and-versioning"></a>[Compatibility and versioning](framework-reference.md#compatibility-and-versioning)

<a id="current-limits"></a>[Current limits](framework-reference.md#current-limits)

<a id="where-each-api-is-used"></a>[Where each API is used](framework-rendering.md#where-each-api-can-be-used)
