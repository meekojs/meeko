---
source-hash: 95f8589d1de5e64f1cacd4e79cb12141a600fb5d2b5f977b2f29644f5d30459f
---

# Layouts

A layout keeps shared structure alive while the page changes. It renders its content with `<MeekoOutlet />`. For navigation examples, see [Navigation](routing-navigation.md).

## Named layouts

Create `app/layouts/dashboard.meeko` and select it with `definePage({ layout: 'dashboard' })`. Without that option, the inherited layout or `default` is used. `layout: false` removes the named layout; `app/app.meeko` and folder `+layout.meeko` files remain.

The order is `app/app.meeko` → named layout → nested `+layout.meeko` → page. Shared layouts keep their state during navigation. [See naming, precedence and diagnostics](routing-layouts-reference.md#named-layouts).

### Per-folder options: `+group.ts`

A group applies a layout to its pages without adding a URL segment:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard' })
```

The page can choose another layout. [See inheritance and migration](routing-layouts-reference.md#per-folder-options-groupts).

### Layouts from layers and modules

Layers and modules can also provide named layouts. When names collide, Meeko applies a defined precedence. [See the full order](routing-layouts-reference.md#layouts-from-layers-and-modules).

## Layout props from the page

Declare layout props with `defineProps` and pass them through `definePage({ layoutProps })`; Meeko checks their types. A layout that stays mounted can update its props with `useLayout().set(...)`. [See examples and lifecycle](routing-layouts-reference.md#layout-props-from-the-page).
