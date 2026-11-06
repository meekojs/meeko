---
source-hash: 1f1d1b3351a737be734a6420ceb9a371bdb42b72c0d427ab06545c38ccb72d73
---

# Components and the .meeko language

This page describes the component engine's public contract, exercised by the examples and tests. The [stability policy](stability.md) specifies what SemVer covers in the 1.x series.

This guide covers the standalone component engine. Conventions for `app/`, routes, middleware, API, RPC, Socket and sessions are in the [framework guide](framework.md).

Start with a `<template>` and add a `<script lang="ts">` when the component needs state or events. This counter works in both the standalone engine and a framework application:

```html
<script lang="ts">
	import { signal } from '@meekojs/meeko'

	const count = signal(0)
</script>

<template>
	<button on:click="() => count.value++">{count.value}</button>
</template>
```

The script runs when the component is created; the template reads `count.value`, and the event updates the signal. To receive data from the parent, use `const props = defineProps<{ label: string }>()` and read `props.label` in the template. [Reactive props](component-basics.md#reactive-props), [model](component-template.md#form-controls-with-model) and [lists](component-template.md#lists-with-and-without-eachkey) cover the next common cases. Later sections describe the compilation contract and advanced options.

## Explore by topic

These guides preserve the examples and full contracts from the former API page:
- [Components and props](component-basics.md)
- [Templates and directives](component-template.md)
- [Component styles](component-styles.md)
- [Dynamic components and tags](component-dynamic.md)
- [Attributes and static props](component-attributes.md)
- [Events, models and snippets](component-events.md)
- [Composition and generated module](component-advanced.md)
- [Reactivity and lifecycle](language-reactivity.md)
- [Built-in components](component-builtins.md)

## Tools

`meeko check archivo.meeko` checks syntax and types; `--json` delivers structured diagnostics. `meeko compile entrada.meeko salida.ts` generates the typed module and does not write a file if there are errors. `meeko types archivo.meeko` emits `Archivo.d.meeko.ts` declarations for that component and imported children under `.meeko/types/`, mirroring their project-relative path; it does not write declarations alongside sources. In a framework application, generation records its outputs in `.meeko/manifests/component-types.json` and removes only managed declarations whose component no longer exists. The first run after upgrading recognizes only orphaned generated declarations from older versions through the AST, while preserving unrelated files and regenerating current components. To resolve those imports with precise props, TypeScript needs `allowArbitraryExtensions` and `rootDirs` overlaying the source tree with `.meeko/types/`. `meeko init` writes that configuration; a manually configured consumer must incorporate it. The `@meekojs/meeko/vite` plugin compiles `.meeko` imports in the client and SSR and adds HMR and CSS during development. `meeko lsp --stdio` (also available as the `meeko-language-server` binary) starts the language server used by the [VS Code extension](../../packages/vscode/README.md) and [other editors](editors.md) to offer the same checks in the editor.

`@meekojs/meeko/prettier` is the Prettier plugin for `.meeko`. With `{ "plugins": ["@meekojs/meeko/prettier"] }` in Prettier configuration, `prettier --write "**/*.meeko"` formats script, `<script server>`, template and style; the `meekoIndentSections` option (default `false`) indents all section content by one level, and `meekoPreserveArrayBreaks` (default `true`) keeps an array with a newline after `[` expanded throughout all JavaScript and TypeScript Prettier formats, like `objectWrap: "preserve"` for objects. The language server uses the same plugin, so the editor and CI agree (see [editors](editors.md#formatting-with-prettier)).

## Compatibility and limits
- Node.js 24 or later and TypeScript 7.0.2 for the CLI, build, Vite and language server. Supported runtimes and browsers are listed in the [stability policy](stability.md#supported-environments).
- The public API follows SemVer during the 1.x series: breaking changes require a major version and deprecations are announced in a minor (see the [stability policy](stability.md)). The package is distributed as `@meekojs/meeko` under the MIT license.
- The parser accepts the TypeScript and HTML subset described above; it reports unsupported constructs through diagnostics.
- Hydration requires server and browser to obtain the same initial values and list order.
- No compatibility guarantees are provided for Vue plugins. Streaming SSR (`render: "stream"` with `defer` from `@meekojs/meeko/framework`) is described in [framework.md](framework.md).

## Package verification

`pnpm run package:smoke` installs the tarball in a consumer outside the monorepo and checks the CLI, SSR, types and Vite. `tests/package-boundaries.test.ts` fixes the exact list of root exports. The VS Code extension is packaged and tested in an isolated host with an external consumer project. The steps for each publication are in [releasing.md](releasing.md).

## Links to previous sections

Existing fragment links to this page remain here and lead to their new locations.
- <a id="meeko-components"></a>[.meeko components](component-basics.md#meeko-components)
- <a id="destructuring-in-the-script"></a>[Destructuring in the script](component-basics.md#destructuring-in-the-script)
- <a id="reactive-props"></a>[Reactive props](component-basics.md#reactive-props)
- <a id="default-values-in-defineprops"></a>[Default values in defineProps](component-basics.md#default-values-in-defineprops)
- <a id="constants-in-default-values"></a>[Constants in default values](component-basics.md#constants-in-default-values)
- <a id="destructure-props"></a>[Destructure props](component-basics.md#destructure-props)
- <a id="conditions-with-ifwhen-and-types"></a>[Conditions with if:when and types](component-template.md#conditions-with-ifwhen-and-types)
- <a id="form-controls-with-model"></a>[Form controls with model](component-template.md#form-controls-with-model)
- <a id="select-with-rich-content"></a>[<select> with rich content](component-template.md#select-with-rich-content)
- <a id="unescaped-html-with-html"></a>[Unescaped HTML with html](component-template.md#unescaped-html-with-html)
- <a id="trusted-html-trustedhtml-and-trusthtml"></a>[Trusted HTML: TrustedHtml and trustHtml](component-template.md#trusted-html-trustedhtml-and-trusthtml)
- <a id="html-that-travels-once-documenthtml"></a>[HTML that travels once: documentHtml](component-template.md#html-that-travels-once-documenthtml)
- <a id="lists-with-and-without-eachkey"></a>[Lists with and without each:key](component-template.md#lists-with-and-without-eachkey)
- <a id="component-styles-style-and-style-scoped"></a>[Component styles: <style> and <style scoped>](component-styles.md#component-styles-style-and-style-scoped)
- <a id="scoped-styles-and-global"></a>[Scoped styles and :global(...)](component-styles.md#scoped-styles-and-global)
- <a id="which-elements-receive-the-attribute"></a>[Which elements receive the attribute](component-styles.md#which-elements-receive-the-attribute)
- <a id="elements-without-content-div-"></a>[Elements without content (<div />)](component-template.md#elements-without-content-div-)
- <a id="component-tags-appbutton-"></a>[Component tags (<AppButton />)](component-dynamic.md#component-tags-appbutton-)
- <a id="html-tags-in-component-is"></a>[HTML tags in <component is>](component-dynamic.md#html-tags-in-component-is)
- <a id="component-names-in-is"></a>[Component names in is](component-dynamic.md#component-names-in-is)
- <a id="a-button-that-is-a-route-link-or-button"></a>[A button that is a route, link or button](component-dynamic.md#a-button-that-is-a-route-link-or-button)
- <a id="attributes-by-tag"></a>[Attributes by tag](component-attributes.md#attributes-by-tag)
- <a id="attribute-values"></a>[Attribute values](component-attributes.md#attribute-values)
- <a id="class-and-style-alongside-bindclass-and-bindstyle"></a>[class and style alongside bind:class and bind:style](component-attributes.md#class-and-style-alongside-bindclass-and-bindstyle)
- <a id="bulk-attributes-with-bind"></a>[Bulk attributes with bind](component-attributes.md#bulk-attributes-with-bind)
- <a id="static-props"></a>[Static props](component-attributes.md#static-props)
- <a id="component-events-defineemits-and-on"></a>[Component events: defineEmits and on:](component-events.md#component-events-defineemits-and-on)
- <a id="component-models-definemodel-and-model"></a>[Component models: defineModel and model](component-events.md#component-models-definemodel-and-model)
- <a id="snippets-with-definesnippets"></a>[Snippets with defineSnippets](component-events.md#snippets-with-definesnippets)
- <a id="expose-values-defineexpose"></a>[Expose values: defineExpose](component-advanced.md#expose-values-defineexpose)
- <a id="element-references-ref-and-useelementref"></a>[Element references: ref: and useElementRef](component-advanced.md#element-references-ref-and-useelementref)
- <a id="generic-components-generic"></a>[Generic components (generic)](component-advanced.md#generic-components-generic)
- <a id="top-level-composables-and-await"></a>[Top-level composables and await](component-advanced.md#top-level-composables-and-await)
- <a id="generated-module"></a>[Generated module](component-advanced.md#generated-module)
- <a id="reactivity"></a>[Reactivity](language-reactivity.md#reactivity)
- <a id="lifecycle"></a>[Lifecycle](language-reactivity.md#lifecycle)
- <a id="stable-ids-useid"></a>[Stable IDs: useId](language-reactivity.md#stable-ids-useid)
- <a id="built-in-components"></a>[Built-in components](component-builtins.md#built-in-components)
- <a id="popover-meekopopover"></a>[Popover: <MeekoPopover>](component-builtins.md#popover-meekopopover)
- <a id="select-meekoselect"></a>[Select: <MeekoSelect>](component-builtins.md#select-meekoselect)
- <a id="wrapping-another-component"></a>[wrapping another component](component-advanced.md#wrapping-another-component)
