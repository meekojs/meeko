---
title: defineProps
group: macros
since: 1.0.0
description: Declara las props de un componente con un tipo de TypeScript y sus valores por defecto, y devuelve una vista reactiva de sólo lectura que también puede desestructurarse.
symbols:
  - "syntax:defineprops"
related:
  - "syntax:defineemits"
  - "syntax:definemodel"
  - "syntax:definesnippets"
  - "syntax:bind"
  - "syntax:generic"
  - "@meekojs/meeko#Component"
  - docs/api.md#props-reactivas
  - docs/api.md#valores-por-defecto-en-defineprops
  - docs/api.md#desestructurar-las-props
  - docs/api.md#constantes-en-los-valores-por-defecto
  - docs/api.md#props-estáticas
---

`defineProps<Props>()` declara las props que recibe el componente y devuelve el objeto `props`. Es una macro de compilación: no se importa ni existe en ejecución; el compilador lee el tipo `Props` y genera `ComponentProps`, que comprueban `meeko check` y el editor en cada etiqueta del padre.

**Convención de nombres:** si declaras la interfaz de props dentro del mismo `<script>`, llámala `Props` y úsala como `defineProps<Props>()`. `meeko check` y el editor emiten el aviso `MEEK120` cuando esa interfaz local tiene otro nombre; el componente sigue compilando. Los tipos inline, alias e interfaces importadas conservan sus nombres. Para consultar las props desde otro archivo, usa `ComponentProps<"NombreDelComponente">`; no hace falta exportar una interfaz global por componente.

Desde `1.2`, `props` es una vista **reactiva** de sólo lectura: cada lectura de `props.x` en la plantilla, en un `computed` o en un `effect` sigue a la prop cuando el padre la cambia, sin volver a montar el hijo. El argumento opcional es un objeto literal con valores por defecto. Desde `1.8`, el resultado también puede desestructurarse (`const { label, size = "md", ...rest } = defineProps<Props>()`) sin perder la reactividad.

## Uso

```html
<!-- app/components/AppCounter.meeko -->
<script lang="ts">
interface Props {
  label: string;
  initial?: number;
  step?: number;
}

const props = defineProps<Props>({ step: 1 });
const count = signal(props.initial ?? 0); // sólo el valor inicial
</script>

<template>
  <button type="button" on:click="() => count.value += props.step">{props.label}: {count.value}</button>
</template>
```

```html
<AppCounter label="Visitas" bind:initial="10" />
```

`step` tiene valor por defecto, así que es opcional para el padre y, dentro del componente, siempre es `number`. Pasar la prop a `signal(...)`, sola o en una expresión como `props.initial ?? 0`, declara que la señal sólo toma su valor inicial; hasta `1.6`, la expresión daba un falso aviso `MEEK101` y hacía falta envolverla en `untrack`.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `Props` (argumento de tipo) | un tipo de objeto | obligatorio | Las props: una interfaz, un alias, una intersección o una unión. Sin argumento de tipo es `MEEK017`. |
| `defaults` | objeto literal | ninguno | Valores por defecto. Cada clave debe existir en `Props` y su valor, tener su tipo. Esas props pasan a ser opcionales para el padre y nunca son `undefined` dentro. |

El argumento de defaults debe ser un **objeto literal con propiedades con nombre**: sin spreads ni claves calculadas (`MEEK041`), sin claves repetidas (`MEEK042`) y sin valores `undefined`. Sus valores pueden usar literales, imports y, desde `1.8`, constantes de nivel superior del script que sólo usan literales e imports; otra variable del setup es `MEEK123`. Las variables que el propio valor declara (una variable local, un bloque, un `catch`, un parámetro o el nombre de un accessor) no cuentan; `arguments`, `new.target` y `super` de la función del setup, sí (`MEEK123`).

Con una unión de props, un default literal (`kind = "a"`, o una constante de nivel superior con un literal) hace opcional su prop sólo en las variantes que admiten ese valor: con `{ kind: "a"; a: string } | { kind: "b"; b: string }` y `kind = "a"`, el padre puede omitir `kind` con `a`, pero tiene que pasar `kind="b"` con `b`. Un default que no es un literal es opcional en todas las variantes, así que cada variante que exige la prop debe admitirlo (`MEEK131`, desde `1.8`).

Con la desestructuración, los defaults se escriben en el patrón (`size = "md"`) y equivalen al argumento; no pueden ir en los dos sitios (`MEEK124`).

## Valor devuelto

`Readonly<Props>`, con los defaults aplicados. Es una vista de las props actuales, o sus nombres si se desestructura (véase [Desestructurar las props](#desestructurar-las-props)):

- leer `props.x` en la plantilla, en un `computed`, en un `effect` o en la función de entrada de `useApi` sigue a la prop;
- `"x" in props`, `Object.keys(props)` y `{ ...props }` ven las props que el padre añade o deja de pasar;
- una prop que pasa a `undefined` vuelve a su default;
- asignar, borrar o definir una propiedad de `props` en el navegador lanza `TypeError`.

## Ejemplos

### Desestructurar las props

Desde `1.8`, cada nombre desestructurado lee su prop allí donde se usa: en la plantilla, en un `computed`, en un `effect` o en un manejador sigue al padre, igual que `props.x`:

```html
<!-- app/components/AppTag.meeko -->
<script lang="ts">
interface Props {
  label: string;
  tone?: "neutral" | "danger";
  class?: string;
  title?: string;
}

const { label, tone = "neutral", class: className, ...rest } = defineProps<Props>();
const upper = computed(() => label.toUpperCase());
</script>

<template>
  <span bind:class="`tag tag--${tone} ${className ?? ''}`" bind="rest">{upper.value}</span>
</template>
```

- `tone = "neutral"` es un default: la prop es opcional para el padre y nunca es `undefined` dentro. El editor lo muestra en el hover y en el completado del padre (`tone?: "neutral" | "danger" = "neutral"`).
- `class: className` renombra una prop, útil con palabras reservadas.
- `...rest` es una vista de sólo lectura de las demás props (aquí, `title`), sin las desestructuradas ni los manejadores de `defineEmits`, que sigue al padre: `bind="rest"` escribe sus atributos en cada momento.
- Un parámetro, una variable local, un `each:as` o un parámetro de snippet con el mismo nombre es otra variable.
- Las uniones se estrechan en el script y en la plantilla: `if:when="to !== undefined"` da los `params` de esa rama. El [botón polimórfico](../../api.md#un-botón-que-es-ruta-enlace-o-botón) de la guía tiene una versión desestructurada.

### Constantes en los valores por defecto

Desde `1.8`, un default puede leer una constante de nivel superior cuyo valor sólo usa literales, imports y otras constantes así. Se evalúa otra vez con los defaults, así que un objeto sigue siendo nuevo por instancia:

```html
<script lang="ts">
const SIZES = ["sm", "md", "lg"] as const;
const DEFAULT_SIZE = SIZES[1];
const { size = DEFAULT_SIZE } = defineProps<{ size?: "sm" | "md" | "lg" }>();
</script>

<template><span bind:class="`size-${size}`">{size}</span></template>
```

### Valores por defecto creados por instancia

El objeto de defaults se evalúa en cada render o hidratación, así que un array o un objeto creado dentro es nuevo por instancia:

```html
<script lang="ts">
const props = defineProps<{ title: string; tags?: string[]; size?: "sm" | "md" | "lg" }>({ tags: [], size: "md" });
</script>

<template>
  <h3 bind:class="`title title--${props.size}`">{props.title}</h3>
  <p if:when="props.tags.length">{props.tags.join(", ")}</p>
</template>
```

### Derivar de una prop sin perder la reactividad

El setup se ejecuta una vez. Para seguir a la prop, léela donde se usa o deriva con `computed`:

```html
<script lang="ts">
const props = defineProps<{ name: string; price: number }>();
const label = computed(() => `${props.name.toUpperCase()} · ${props.price.toFixed(2)} €`);
</script>

<template><p>{label.value}</p></template>
```

### Un callback como prop

Una prop puede ser una función. `defineEmits` lo hace más corto, pero una prop declarada a mano sigue siendo válida:

```html
<script lang="ts">
const props = defineProps<{ items: string[]; onPick?: (item: string) => void }>();
</script>

<template>
  <ul><li each:of="props.items" each:as="item" on:click="() => props.onPick?.(item)">{item}</li></ul>
</template>
```

### Las props de una página

Una página recibe `params`, `search` y, con un loader, `data`; `meeko check` comprueba que su tipo coincide con lo que entregan las opciones de ruta:

```html
<!-- app/pages/products/[slug].meeko -->
<script server lang="ts">
export const route = definePage({ load: ({ params }) => ({ name: `Producto ${params.slug ?? ""}` }) });
</script>

<script lang="ts">
export interface Props {
  params: { slug: string };
  search: Record<string, string | string[]>;
  data: { name: string };
}
const props = defineProps<Props>();
</script>

<template><h1>{props.data.name}</h1></template>
```

## Errores comunes

### Desestructuración anidada

```html bad
<script lang="ts">
const { user: { name } } = defineProps<{ user: { name: string } }>();
</script>
```

`MEEK015: defineProps no admite desestructuración anidada: el valor interior sería una copia que no sigue a la prop. Desestructura la prop entera, como const { user } = defineProps<Props>(), y lee sus campos donde los uses`. Un array, una clave calculada y `let` también son `MEEK015`. Hasta `1.7`, cualquier desestructuración lo era.

```html good
<script lang="ts">
const { user } = defineProps<{ user: { name: string } }>();
</script>

<template><p>{user.name}</p></template>
```

### Asignar una prop desestructurada

```html bad
<script lang="ts">
const { count } = defineProps<{ count: number }>();
</script>

<template><button type="button" on:click="() => count++">{count}</button></template>
```

`MEEK125: count es la prop count de defineProps y es de sólo lectura: no se puede asignar ni borrar con delete. Para cambiar un valor del padre, emite un evento (defineEmits) o usa un modelo (defineModel); para un valor propio que empieza con la prop, usa signal(count)`. `delete count` también es `MEEK125`: borraría la prop del objeto que pasa el padre.

```html good
<script lang="ts">
const { count } = defineProps<{ count: number }>();
const current = signal(count);
</script>

<template><button type="button" on:click="() => current.value++">{current.value}</button></template>
```

### Copiar una prop desestructurada en el setup

```html bad
<script lang="ts">
const { label } = defineProps<{ label: string }>();
const upper = label.toUpperCase();
</script>
```

Compila, pero `upper` conserva el valor inicial: `meeko check` avisa con `MEEK101: label es una prop de defineProps y aquí se lee una sola vez porque el setup se ejecuta una sola vez…`.

```html good
<script lang="ts">
const { label } = defineProps<{ label: string }>();
const upper = computed(() => label.toUpperCase());
</script>
```

### Defaults en el patrón y en el argumento

```html bad
<script lang="ts">
const { size = "md" } = defineProps<{ size?: string }>({ size: "sm" });
</script>
```

`MEEK124: Los valores por defecto van en la desestructuración o en el argumento de defineProps, no en los dos: escríbelos en la desestructuración, como size = …, y quita el argumento`.

```html good
<script lang="ts">
const { size = "md" } = defineProps<{ size?: string }>();
</script>
```

### Un default que depende del setup

```html bad
<script lang="ts">
const start = signal(1);
const { count = start.value } = defineProps<{ count?: number }>();
</script>
```

`MEEK123: El valor por defecto de la prop count usa start, que depende del setup: su valor llama a una función, que podría depender del setup o tener efectos. Los valores por defecto se evalúan antes del setup…`. Una variable `let`, una función del script, otra prop, el valor de una llamada (`Date.now()`) o `arguments` también lo son. Una variable que declara el propio default, como `(() => { const start = 2; return start; })()`, no.

```html good
<script lang="ts">
const START = 1;
const { count = START } = defineProps<{ count?: number }>();
</script>
```

### Un default no literal en el discriminante de una unión

```html bad
<script lang="ts">
import { DEFAULT_KIND } from "./kinds";
type Props = { kind: "a"; a: string } | { kind: "b"; b: string };
const { kind = DEFAULT_KIND } = defineProps<Props>();
</script>
```

`MEEK131: el valor por defecto de kind no es un literal y alguna variante de las props exige kind con un valor que no lo admite…`. Con un default que no es un literal, `kind` sería opcional en las dos variantes y el padre podría pasar `b` sin `kind`, que tomaría `"a"`. Escribe un literal o una constante de nivel superior con un literal: `kind` sólo es opcional en la variante que lo admite.

```html good
<script lang="ts">
type Props = { kind: "a"; a: string } | { kind: "b"; b: string };
const { kind = "a" } = defineProps<Props>();
</script>
```

### Copiar una prop en el setup

```html bad
<script lang="ts">
const props = defineProps<{ label: string }>();
const upper = props.label.toUpperCase();
</script>
```

Compila, pero `upper` conserva el valor inicial. `meeko check` avisa con `MEEK101: props.label se lee una sola vez porque el setup se ejecuta una sola vez: no se actualizará cuando el padre cambie la prop; léela donde se usa: {props.x} en la plantilla, computed(() => props.x) o una función. Si sólo quieres el valor inicial, usa signal(props.label) o untrack(() => props.label)`.

```html good
<script lang="ts">
const props = defineProps<{ label: string }>();
const upper = computed(() => props.label.toUpperCase());
</script>
```

### Sin argumento de tipo

```html bad
<script lang="ts">
const props = defineProps();
</script>
```

`MEEK017: defineProps necesita un argumento de tipo`.

```html good
<script lang="ts">
const props = defineProps<{ title: string }>();
</script>
```

### Llamarla dos veces

```html bad
<script lang="ts">
const props = defineProps<{ title: string }>();
const more = defineProps<{ subtitle: string }>();
</script>
```

`MEEK016: defineProps debe aparecer una sola vez, en su propia declaración`.

```html good
<script lang="ts">
const props = defineProps<{ title: string; subtitle: string }>();
</script>
```

### Defaults que no son un objeto literal

```html bad
<script lang="ts">
const base = { tags: [] };
const props = defineProps<{ tags?: string[] }>({ ...base });
</script>
```

`MEEK041: Los valores por defecto de defineProps necesitan propiedades con nombre`. Desde `1.8`, una variable del setup como valor (`{ count: fallback }`) es `MEEK123` (hasta `1.7`, `TS2304: Cannot find name 'fallback'.`), salvo una constante de literales e imports.

```html good
<script lang="ts">
const props = defineProps<{ tags?: string[] }>({ tags: [] });
</script>
```

### Defaults que no coinciden con `Props`

```html bad
<script lang="ts">
const props = defineProps<{ count?: number }>({ count: "3", size: 2 });
</script>
```

`meeko check` da `TS2322: Type 'string' is not assignable to type 'number'.` y, para la clave que no existe, `TS2322: Type 'number' is not assignable to type 'never'.`

```html good
<script lang="ts">
const props = defineProps<{ count?: number }>({ count: 3 });
</script>
```

### Una prop obligatoria que el padre no pasa

```html bad
<AppCounter bind:initial="10" />
```

`meeko check` da `TS2345: Argument of type '{ initial: number; }' is not assignable to parameter of type …` con `Property 'label' is missing`. Una prop que el hijo no declara da `TS2353`, y una del tipo equivocado, `TS2322`.

```html good
<AppCounter label="Visitas" bind:initial="10" />
```

## Notas

- **SSR e hidratación.** El servidor renderiza con las props y el navegador hidrata con las mismas, que viajan en el payload: deben poder serializarse en JSON cuando el componente es una página o un layout, y los defaults deben ser deterministas (nada de `Date.now()` ni `Math.random()`).
- **Reactividad.** El setup se ejecuta una vez por instancia; sólo las lecturas dentro de la plantilla, un `computed`, un `effect` o una función siguen a la prop. Los componentes con un `await useApi(...)` de nivel superior se vuelven a montar con props nuevas.
- **Sólo lectura.** Para cambiar un valor del padre, emite un evento (`defineEmits`) o usa un modelo (`defineModel`). Desde `1.7`, el script ve las props como `Readonly<Props>`: asignar `props.x` es el error `TS2540` en `meeko check` y el editor, y en ejecución lanza `TypeError`.
- **Dónde va.** En su propia declaración `const` de nivel superior, con un nombre o desestructurada, antes de cualquier `await` de navegador (`MEEK058`). En `<script server>` es `MEEK108`.
- **Tipos.** El módulo compilado exporta `ComponentProps`; cada componente autoimportado tiene además `<Nombre>Props`, como `AppCounterProps`, sin import.
