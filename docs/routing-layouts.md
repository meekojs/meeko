# Layouts

Un layout conserva la estructura compartida mientras cambia la página. Pinta su contenido con `<MeekoOutlet />`. Para ejemplos de navegación, consulta [Navegación](routing-navigation.md).

## Layouts con nombre

Crea `app/layouts/dashboard.meeko` y elígelo con `definePage({ layout: 'dashboard' })`. Sin esa opción se usa el layout heredado o `default`. `layout: false` quita el layout con nombre; `app/app.meeko` y los `+layout.meeko` de las carpetas permanecen.

El orden es `app/app.meeko` → layout con nombre → `+layout.meeko` anidados → página. Al navegar, los layouts compartidos conservan su estado. [Ver nombres, precedencia y diagnóstico](routing-layouts-reference.md#layouts-con-nombre).

### Opciones por carpeta: `+group.ts`

Un grupo aplica un layout a sus páginas sin añadir un segmento a la URL:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard' })
```

La página puede elegir otro layout. [Ver herencia y migración](routing-layouts-reference.md#opciones-por-carpeta-groupts).

### Layouts de layers y módulos

Los layers y módulos también pueden aportar layouts con nombre. Si hay nombres repetidos, Meeko aplica una precedencia definida. [Ver el orden completo](routing-layouts-reference.md#layouts-de-layers-y-módulos).

## Props del layout desde la página

Declara las props del layout con `defineProps` y pásalas desde `definePage({ layoutProps })`; Meeko comprueba los tipos. Un layout que se conserva puede actualizar sus props con `useLayout().set(...)`. [Ver ejemplos y ciclo de vida](routing-layouts-reference.md#props-del-layout-desde-la-página).
