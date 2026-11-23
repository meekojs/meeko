---
source-hash: 47335279b35aff7ff12b4a645b8a84dc477ce352212025938299541ace495fea
---

# Your first application

You will turn the starter into a task list with a filter and a second page. The list appears in the initial HTML; the button becomes interactive after hydration in the browser. No database is needed.

## Create and open the project

You need Node.js 24 or later and pnpm 12 to download the CLI. From the directory where you want to create `my-app`:

```powershell
npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init-framework my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:4173`. You will see the starter counter. If you already followed [Quick start](inicio-rapido.md), keep the same project and continue here.

## Replace the home page

**File: `my-app/app/pages/index.meeko`.** Replace its entire contents with:

```meeko
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>

<script lang="ts">
import { signal } from "@meekojs/meeko";

const tasks = [
  { id: 1, title: "Create a page", done: true },
  { id: 2, title: "Try the filter", done: false },
  { id: 3, title: "Add another route", done: false },
];
const onlyPending = signal(false);
</script>

<template>
  <main>
    <h1>My tasks</h1>
    <p>A small list to get started with Meeko.</p>
    <button type="button" on:click="() => onlyPending.value = !onlyPending.value">
      {onlyPending.value ? "Show all" : "Show pending"}
    </button>
    <ul>
      <li
        each:of="onlyPending.value ? tasks.filter((task) => !task.done) : tasks"
        each:as="task"
        each:key="task.id"
      >
        {task.title}{task.done ? " ✓" : ""}
      </li>
    </ul>
    <a href="/about">About this list</a>
  </main>
</template>
```

Save the file. You will see three tasks. Clicking “Show pending” leaves two. `render: "prerender"` produces the initial HTML during the build; the browser hydrates the button and `signal` updates the list. In the framework, `definePage` is available in the `server` block; `signal` is explicitly imported from the engine.

## Add a route

**New file: `my-app/app/pages/about.meeko`.** Create it with:

```meeko
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>

<template>
  <main>
    <h1>About this list</h1>
    <p>My first Meeko app has two pages.</p>
    <a href="/">Back to my tasks</a>
  </main>
</template>
```

Open `http://localhost:4173/about` or follow the link from the list. Files in `app/pages` define routes; an `<a>` is enough to link pages here. See [navigation](routing-navigation.md) when you need active links or programmatic navigation.

## Check the result

Stop `npm run dev` with Ctrl+C. From `my-app`:

```powershell
npm run check
npm run build
```

`check` verifies types and `build` generates pages. If the editor reports an error, check that each file is in `app/pages`, the `signal` import is in the client script and Node is 24 or later.

Continue with [loading route data](routing-data.md) to replace the fixed list with server data. The [component guide](api.md) covers props, composition and styles when you extract the list to `app/components`.
