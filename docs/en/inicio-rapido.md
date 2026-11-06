---
source-hash: ecab4677a40f384b2c49d2847212b6966d49aac88b6f1385db0d60a3561456e3
---

# Quick start

In a few minutes you will have a server-rendered page and a button that responds in the browser. This path uses Meeko Framework, which adds routes and a server to the `.meeko` component engine.

## Requirements

You need **Node.js 24 or later**, access to npm and a terminal. `npm exec` downloads the published CLI without a global installation; all commands use npm.

<a id="crear-una-aplicación-full-stack"></a>

## Create a full-stack application

From the directory where you want to create `my-app`, run:

```powershell
npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init-framework my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:4173`. You will see “Welcome to Meeko” and “Count: 0”. Click the button: the number increases without reloading the page. The CLI pins the published version in the generated `package.json`.

<a id="desarrollo"></a>

## Change the first page

Open `my-app/app/pages/index.meeko` and replace `Welcome to Meeko` inside `<h1>` with `My first page`. Save the file and check the new heading in the browser. The same component contains the `count` signal and the `on:click` event.

To check types, stop the server with Ctrl+C and run this from `my-app`:

```powershell
npm run check
```

## If something fails

- If `npm` is missing, install Node.js 24 or later before the first command.
- If Node is older than 24, update it before running the CLI.
- If port 4173 is occupied, open the address printed by `npm run dev`.
- If the CLI rejects the destination, choose a new directory name; it will not overwrite an existing app.

<a id="crear-una-aplicación-ssr"></a>

## If you only need the engine

`meeko init` creates a small SSR app without the framework router. From a clean directory you can run `npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init engine-app`, enter `engine-app`, install with `npm install` and start with `npm run dev`. Choose this path when you want to integrate `.meeko` components instead of organizing pages and a server with the framework.

Continue with [First application](primeros-pasos.md) to add another page and distinguish server and browser. If you only need the `.meeko` engine in Vite, see [the component model](api.md) and [its exports](/docs/reference/exports).
