---
title: Registro de componentes
group: components
since: 1.7.0
description: Descubre componentes .meeko por directorio, consulta sus tipos y cárgalos por nombre.
symbols:
  - "@meekojs/meeko#ComponentRegistry"
  - "@meekojs/meeko#ComponentName"
  - "@meekojs/meeko#ComponentOf"
  - "@meekojs/meeko#ComponentProps"
  - "@meekojs/meeko#ResolvedComponent"
related:
  - "syntax:component-tag"
  - docs/framework.md#autoimports-y-typescript
---

Meeko descubre los archivos `.meeko` de `app/components` sin importar cada módulo a mano. Los directorios adicionales se declaran en `meeko.config.ts`. El mismo catálogo alimenta los autoimports por etiqueta, el registro tipado y un loader generado para cargar un componente por nombre.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  components: {
    dirs: [
      { path: "app/components/Form", prefix: "Form" },
      { path: "app/widgets", prefix: "Widget" },
    ],
  },
});
```

`app/components` siempre está incluido, incluso si se configura `components.dirs`. Las rutas son relativas a la raíz del proyecto o de cada layer. `path` debe ser una ruta relativa segura; `prefix` es opcional, vacío por defecto, y, si se indica, debe empezar en mayúscula y contener solo letras o números. Se descubren archivos `.meeko` en subdirectorios; los demás archivos no se convierten en componentes registrados.

El nombre se forma con el prefijo más los segmentos de la ruta relativa al directorio elegido, en PascalCase. Los guiones y guiones bajos separan palabras:

| Archivo                                | Directorio que lo registra            | Nombre           |
| -------------------------------------- | ------------------------------------- | ---------------- |
| `app/components/Button.meeko`          | `app/components`                      | `Button`         |
| `app/components/Form/UserCreate.meeko` | `app/components/Form`, prefijo `Form` | `FormUserCreate` |
| `app/components/Form/UserEdit.meeko`   | `app/components/Form`, prefijo `Form` | `FormUserEdit`   |
| `app/components/user-menu.meeko`       | `app/components`                      | `UserMenu`       |

Si un archivo pertenece a dos directorios configurados de una misma fuente, gana el directorio más específico y el archivo se registra una sola vez. Así, el prefijo `Form` del ejemplo no se suma a la carpeta `Form` por segunda vez. Entre fuentes gana primero el proyecto, luego `extends` y `layers` en el orden de resolución de Meeko, y después los aportes de módulos. Dos archivos distintos con el mismo nombre dentro de una misma fuente producen un error con ambas rutas; cambie el nombre o el prefijo.

Un módulo existente puede aportar componentes con `meeko.addComponentsDir(dir, { prefix: "Accent" })`. Estos participan en el catálogo final sin crear otro sistema de layers. En un workspace no confiable, el servidor de lenguaje lee la configuración de forma estática y no ejecuta módulos: allí no puede descubrir componentes que dependen de `setup` del módulo.

## Opciones

Meeko genera `.meeko/types/components.d.ts` con las entradas de `ComponentRegistry`. Cada entrada apunta al módulo `.meeko` real. Los tipos públicos de `@meekojs/meeko` son:

| Tipo                      | Significado                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ComponentRegistry`       | Relación entre nombre y módulo de cada componente registrado.                                                                                               |
| `ComponentName`           | Unión de los nombres registrados.                                                                                                                           |
| `ComponentOf<Name>`       | Módulo renderizable correspondiente a `Name`, con sus exports públicos.                                                                                     |
| `ComponentProps<Name>`    | Props de entrada extraídas del contrato de `renderToString` de ese módulo.                                                                                  |
| `ResolvedComponent<Name>` | Componente con sus props ya asociadas mediante `resolveComponent(name, props)`. `Name` es opcional para almacenar distintos componentes en un mismo estado. |

<!-- no-check -->

```ts
// app/utils/component-types.ts
type Name = ComponentName; // Por ejemplo: "Button" | "FormUserCreate" | "FormUserEdit"
type FormModule = ComponentOf<"FormUserCreate">;
type FormInput = ComponentProps<"FormUserCreate">;

const known: ComponentName = "FormUserCreate";
// const unknown: ComponentName = "Missing"; // Error de TypeScript.
```

Los tipos siguen el contrato que compila `defineProps`, incluidas props obligatorias, opcionales y tipos importados. `ComponentOf` conserva además los exports de eventos, modelos y snippets del módulo; `ComponentProps` describe las props de entrada. En `<script>` de un `.meeko` también puedes usar `ComponentProps<"FormUserCreate">` sin import manual; el componente sigue exportando su propio tipo `ComponentProps` para quienes lo importen desde el módulo.

En un componente genérico, `ComponentOf<Name>` conserva las firmas genéricas exportadas. `ComponentProps<Name>` extrae la forma de entrada sin elegir argumentos de tipo concretos; para una especialización, usa el contrato genérico del módulo directamente.

Para una función que recibe nombres de una unión, una unión de tuplas conserva la relación entre cada nombre y sus props en la llamada:

<!-- no-check -->

```ts
// app/utils/modal-request.ts
function openModal(...request: ComponentArgs): void {
  const [name, props] = request;
  // Entregar name y props al modal de la aplicación.
  void name;
  void props;
}

openModal("FormUserCreate", { name: "Diego", role: "admin" });
// Las props exactas dependen de defineProps en Form/UserCreate.meeko.
```

El ejemplo de `openModal` muestra solo el tipado del argumento: Meeko no incorpora un sistema de modales. Si el componente declara otras props, ajuste la llamada a su `defineProps` real.

## Resultado

`resolveComponent(name)` es un autoimport del ámbito `app` que apunta al loader generado en `.meeko/generated/components.ts`. Devuelve **`Promise<ComponentOf<Name>>`**: hay que esperar la carga antes de pasar el módulo a `<component is>`. Cada entrada del loader usa un `import()` con ruta literal, para que Vite pueda analizarla y separar el componente del bundle inicial. Un nombre externo no se interpreta como ruta: un nombre ausente rechaza la promesa con `Componente de Meeko no registrado`.

```html
<!-- app/components/Form/UserCreate.meeko -->
<script lang="ts">
const props = defineProps<{ name: string; role: "admin" | "user" }>();
</script>

<template>
  <p>{props.name}: {props.role}</p>
</template>
```

```html
<!-- app/pages/create.meeko -->
<script lang="ts">
const selected = signal<ResolvedComponent<"FormUserCreate"> | undefined>(undefined);

async function showForm(): Promise<void> {
  selected.value = await resolveComponent("FormUserCreate", {
    name: "Diego",
    role: "admin",
  });
}
</script>

<template>
  <button type="button" on:click="showForm">Crear usuario</button>
  <component
    if:when="selected.value"
    is="selected.value!"
  />
</template>
```

El condicional evita renderizar el componente antes de que se resuelva la promesa. Este ejemplo inicia la carga mediante una interacción del navegador: durante SSR se muestra el botón, y el componente aparece tras la carga en el cliente. No presupone que una promesa sin resolver pueda pasarse a `is` ni que el contenido diferido esté presente en el HTML de SSR. `<component is>` sigue recibiendo el módulo renderizable, no su nombre ni una promesa. Para contenido que deba salir en el HTML inicial, use un componente ya disponible durante el render SSR.

El segundo argumento es un objeto de `ComponentProps<Name>`: TypeScript comprueba props obligatorias, nombres, literales y callbacks contra el componente elegido. Los nombres de una unión y sus props deben formar una pareja válida; una unión de nombres no permite mezclar props de componentes distintos. Cada llamada crea su propia asociación sin modificar el módulo compartido ni las props de otra llamada.

Para limitar una API a un subconjunto del registro, filtre `ComponentArgs` y reenvíe la tupla completa. El resultado conserva ese subconjunto de nombres:

<!-- no-check -->

```ts
type ModalName = Extract<ComponentName, `Modal${string}`>;
type ModalArgs = Extract<ComponentArgs, [name: ModalName, props: unknown]>;

async function openModal(...request: ModalArgs): Promise<ResolvedComponent<ModalName>> {
  return resolveComponent(...request);
}
```

Los valores asociados se capturan cuando termina la carga. Para valores que deban cambiar después, use `bind:` en la plantilla: sus props y eventos explícitos tienen prioridad sobre los valores asociados. Los modelos y snippets siguen pasando por `model`, `model:nombre` y el contenido de la etiqueta. Si cambia la asociación manteniendo el mismo componente, sus props se actualizan en la instancia existente.

```html
<component
  if:when="selected.value"
  is="selected.value!"
  bind:name="'Otro nombre'"
/>
```

La forma de un argumento conserva el comportamiento anterior: `await resolveComponent("FormUserCreate")` devuelve el módulo original, y sus props siguen siendo obligatorias al renderizarlo mediante `bind:` o `bind="objeto"`.

### Un literal en `is` o `resolveComponent`

Desde `1.8`, `<component is>` acepta el nombre de un componente como literal de texto en PascalCase (`is="big ? 'UICard' : 'section'"`), también `'MeekoLink'`. Ese nombre se conoce al escribir la plantilla: el compilador lo importa como su etiqueta, sin promesa, y sale en el HTML de SSR (véase [Nombres de componente en `is`](../../api.md#nombres-de-componente-en-is)). `resolveComponent` es para el nombre que sólo se conoce **en ejecución** (de una URL, de datos, de una tabla) o para cargar el componente en diferido, en su propio chunk.

Los dos usan los mismos nombres: los componentes de `app/components`, los de los directorios configurados, los de módulos como los `UI*` de `@meekojs/ui` y, desde `1.8`, `"MeekoLink"`. `resolveComponent("MeekoLink", { to: "/users/[id]", params: { id: "7" } })` carga `<MeekoLink>` como componente, con una variante de props por ruta: `meeko check` exige los `params` de una ruta dinámica y rechaza una ruta que no existe o un `href`. Si el proyecto tiene un componente propio llamado `MeekoLink`, el nombre es el suyo.

## Ejemplos

Al crear o eliminar un `.meeko` en los directorios registrados, el plugin de Vite vuelve a descubrir el catálogo, regenera el loader y las declaraciones y recarga la página. Una edición de un componente registrado regenera su declaración y las de sus imports `.meeko` si cambiaron, sin recorrer todos los componentes; el HMR del compilador actualiza el módulo. Un cambio de nombre equivale a eliminar la entrada anterior y crear la nueva. Los cambios de configuración pueden requerir un descubrimiento completo. `meeko check` prepara las declaraciones del proyecto antes de comprobar los componentes. Si el editor muestra nombres antiguos, compruebe que terminó la regeneración y vuelva a ejecutar `meeko check` para ver el diagnóstico concreto.

```powershell
npm run check
```

## Errores comunes

### Nombre no registrado

```ts bad
// app/utils/component.ts, con ComponentName generado por el proyecto
const name: ComponentName = "Missing";
```

TypeScript rechaza el nombre porque no figura en `ComponentRegistry`.

```text good
// app/utils/component.ts, después de registrar FormUserCreate.meeko
const name: ComponentName = "FormUserCreate";
```

| Síntoma                                       | Qué revisar                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Componente de Meeko no registrado`           | El nombre distingue mayúsculas; confirme el directorio, prefijo y nombre generado. Valide cadenas externas antes de usarlas. |
| Nombre duplicado o autoimport ambiguo         | Dos archivos generan el mismo nombre; renombre uno o cambie su prefijo.                                                      |
| `ComponentName` no incluye un archivo         | Confirme que es `.meeko`, que está bajo un directorio registrado y que la generación de tipos terminó.                       |
| TypeScript no acepta las props                | Compare la llamada con `defineProps` del componente; `ComponentProps<Name>` no crea props opcionales nuevas.                 |
| `<component is>` recibe un valor incompatible | Espere `resolveComponent(name)` y pase el módulo resultante, no la promesa.                                                  |
| El editor no ve componentes de un módulo      | En un workspace no confiable no se ejecuta `setup`; abra el proyecto como workspace de confianza si corresponde.             |

## Notas

- La aplicación genera el registro desde los directorios configurados y lo actualiza durante el desarrollo.
- `resolveComponent` carga de forma asíncrona; espere su resultado antes de pasarlo a `<component is>`.
