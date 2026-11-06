# Componentes y props

## Componentes `.meeko`

Un componente contiene un `<template>` (sin él, `MEEK007`) y, normalmente, un `<script lang="ts">`; `<style scoped>` es opcional. Desde `1.1` el `<script lang="ts">` también es opcional: un componente con sólo `<template>`, o una página con `<script server>` y `<template>`, compila con un setup vacío y props `Record<string, never>`. `MEEK005`, que exigía el script, ya no se emite. Una página de `app/pages` puede añadir un `<script server lang="ts">` con su código de servidor y sus opciones de ruta, que nunca forma parte del componente; desde `1.1`, sus `export const` llegan al `<script>` y a la plantilla como datos tipados (véase [framework](framework.md#código-de-servidor-de-la-página)).

El nivel superior del `<script>` es el setup del componente y sólo admite estas sentencias:

- `import` y `export type`, `interface` y `type`;
- `const`/`let` con **una** declaración por sentencia (`MEEK014`). Desde `1.2` la declaración puede desestructurar un objeto o un array, con valores por defecto, renombres y resto, como `const { toasts, dismiss } = useToasts()` (véase [Desestructuración en el script](#desestructuración-en-el-script));
- declaraciones `function` con nombre;
- cualquier sentencia de expresión: llamadas como `onCleanup(...)`, `onMounted(...)` o `effect(...)` y, desde `1.2`, también asignaciones y otras expresiones, como `count.value = props.initial`, `label ??= "Sin título"`, `items.value.push(item)` o `void Child`;
- desde `1.2`, control de flujo: `if`, `for`, `for...of`, `for...in`, `while`, `do...while`, `try`, `switch`, bloques `{ ... }`, sentencias etiquetadas sobre ellos (`outer: for (...)`) y sentencias vacías (el `;` sobrante tras una función);
- `await` sobre los composables que lo admiten, como sentencia completa o inicializador completo (véase [Composables de nivel superior y `await`](component-advanced.md#composables-de-nivel-superior-y-await)).

Las sentencias de expresión y de control se ejecutan en orden, igual que las llamadas: en SSR y otra vez al hidratar, antes de que la plantilla lea los nombres del setup. Una escritura como `count.value = props.initial` no rompe la hidratación, porque el servidor y el navegador la repiten con las mismas props, y el estado transferido (o el que conserva una actualización en caliente) se restaura después del setup. Como cualquier código del nivel superior, se repite en cada pasada de un render que espera datos (véase [Navegación y `render: "client"`](framework.md#navegación-y-render-client)): una escritura externa o una petición van en `onMounted` o en un handler. Las declaraciones dentro de un bloque, de un bucle o de un `case` son locales: la plantilla sólo ve las del nivel superior. `useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` dentro de una sentencia de control o de un bloque se ejecutarían de forma condicional o repetida y dan `MEEK054`; `defineProps` fuera de su propia declaración `const` da `MEEK016`.

Cualquier otra sentencia de nivel superior da `MEEK018`, con una indicación de qué escribir en su lugar: `export` de valores (`export const`, `export function`, `export { ... }`, `export default`; el script sólo exporta tipos, y los datos de una página se exportan desde `<script server>`), clases, `enum`, `namespace`, `import x = require(...)`, y `return`, `throw`, `break` o `continue` sueltos (dentro de un `if` o de un bucle sí se admiten). Lleve una clase o un `enum` a un módulo `.ts` e impórtelo. `defineProps<Props>()` es una macro de compilación: declara las props que reciben `renderToString` e `hydrate`; no necesita una implementación en tiempo de ejecución. `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets` y `useElementRef` también son macros de compilación y no se importan.

```html
<script lang="ts">
	import { signal } from '@meekojs/meeko'

	interface Props {
		initial: number
	}
	const props = defineProps<Props>()
	const count = signal(props.initial)
	function increment(): void {
		count.value++
	}
</script>

<template>
	<button
		on:click="increment"
		bind:title="String(count.value)"
	>
		{count.value}
	</button>
</template>
```

### Desestructuración en el script

Desde `1.2`, una declaración de nivel superior puede desestructurar un objeto o un array. Cada nombre es un enlace del setup como cualquier otro: lo ven la plantilla, `meeko check` y el editor.

```html
<script lang="ts">
	const { toasts, dismiss } = useToasts()
	const { title = 'Sin título', ...rest } = props.options
	let [first, , ...others] = pair()
</script>

<template>
	<p
		each:of="toasts.value"
		each:as="toast"
		each:index="index"
	>
		{toast.text}
		<button on:click="() => dismiss(index)">×</button>
	</p>
</template>
```

- **Estado.** Una señal desestructurada sigue siendo una señal, pero no entra en la captura de estado del componente: ni en la transferencia de SSR (`renderWithState`) ni en la que conserva HMR. Pertenece al composable o al store que la devolvió, que puede compartirla entre componentes o guardar valores que no son JSON. Si una señal es estado propio del componente, declárela con un nombre simple (`const count = signal(0)`), que sí se captura.
- **Macros y refs.** Desde `1.8`, `defineProps` admite la desestructuración simple y reactiva (`const { title } = defineProps<Props>()`; véase [Desestructurar las props](#desestructurar-las-props)). Una desestructuración anidada, de array, con clave calculada o con `let` da `MEEK015`. `useElementRef` sí necesita un nombre simple: `const { value } = useElementRef("input")` da `MEEK015`; lea `input.value`. `defineEmits`, `defineModel` y `defineSnippets` siguen exigiendo su propia declaración `const` con nombre simple (`MEEK045`, `MEEK063`, `MEEK059`).
- **Datos con `await`.** El resultado de `await useApi(...)` o `await useRpcQuery(...)` puede desestructurarse: `const { data, refresh } = await useApi("/api/users")`. `data` sigue siendo la señal del recurso, cuyos datos el framework ya envía en el payload.
- **Tras el primer `await` de navegador.** Los nombres desestructurados después de `await useElementRef(...)` o `await useSocket(...)` sólo existen en el navegador, como los demás; la plantilla no puede leerlos (`MEEK057`).

### Props reactivas

Desde `1.2`, cuando el padre cambia una prop, el hijo sigue montado: Meeko le entrega el valor nuevo y sólo se actualizan los bindings que leen esa prop, como en Vue o Svelte. El DOM del hijo, con el foco, el cursor y la composición (IME) de un `<input>` que el usuario está escribiendo, su estado, los snippets que recibió y sus propios hijos se conservan. Hasta `1.1`, Meeko volvía a renderizar el rango del hijo y sólo conservaba sus señales editables por nombre: el campo en el que se escribía se reemplazaba.

```html
<!-- UiTextField.meeko -->
<script lang="ts">
	const props = defineProps<{ label: string; error?: string; hint?: string }>({ hint: '' })
	const value = defineModel<string>('value')
	const invalid = computed(() => Boolean(props.error))
</script>

<template>
	<label>
		{props.label}
		<input
			model="value"
			bind:aria-invalid="invalid.value ? 'true' : 'false'"
		/>
	</label>
	<p if:when="props.error">{props.error}</p>
	<small>{props.hint}</small>
</template>
```

```html
<UiTextField
	model:value="form.fields.name"
	bind:label="'Nombre'"
	bind:error="form.errors.value.name"
/>
```

Si `form.errors.value.name` cambia mientras el usuario escribe, el `<p>` aparece o desaparece y `aria-invalid` cambia, pero el `<input>` es el mismo y conserva el foco y lo tecleado.

- **Qué es reactivo.** `props` es una vista de sólo lectura de las props actuales. Cada lectura de `props.x` en la plantilla, en un `computed`, en un `effect` o en la función de entrada de `useApi` o `useRpcQuery` sigue a la prop, también en los hijos a los que el componente la pasa. `"x" in props`, `Object.keys(props)` y `{ ...props }` ven las props que el padre añade o deja de pasar.
- **Qué no lo es.** El setup se ejecuta una vez por instancia, así que un valor que copia una prop conserva el valor inicial, como en Vue: `const { label } = props` (desestructurar el objeto `props`; desestructurar `defineProps` sí es reactivo, véase [Desestructurar las props](#desestructurar-las-props)), `const title = props.title.toUpperCase()`, `signal(props.initial)` o `useApi(ruta, { query: { q: props.q } })`. Para seguir la prop, léala donde se usa (`{props.label}`), derive con `computed(() => props.title.toUpperCase())` o pase una función a los composables de datos (`useApi(ruta, () => ({ query: { q: props.q } }))`).
- **Aviso `MEEK101`.** `meeko check`, `meeko build` y el editor avisan de cada lectura de `props` que se ejecuta una sola vez: desestructurar o expandir `props` y leer `props.x` en el nivel superior del setup, o directamente dentro de `onMounted` (que tampoco se repite: léala en un `effect` para seguirla). Es un aviso, no un error: no hace fallar la comprobación. No avisan las lecturas dentro de otras funciones (manejadores, `computed`, `effect`), las llamadas a una prop función (`props.onReady?.()`), `signal(props.x)` y `untrack(() => props.x)`, que declaran que sólo interesa el valor inicial (por ejemplo, una clave que no cambia), ni los componentes con un `await` de datos en el nivel superior, que se vuelven a montar.
- **Valores por defecto.** Se aplican en cada lectura: una prop que pasa a `undefined` vuelve a su default.
- **Sólo lectura.** Asignar, borrar o definir una propiedad de `props` en el navegador lanza `TypeError`. Para cambiar un valor del padre, emita un evento (`defineEmits`) o use un modelo (`defineModel`).
- **Cuándo se vuelve a montar.** El rango se reconstruye, conservando las señales editables por nombre, cuando cambia el componente de `<component is>`, cuando el padre pasa otra señal en un `model`, y en los componentes con un `await` de datos en el nivel superior (`await useApi(...)` o `await useRpcQuery(...)`): sus peticiones se construyeron con las props con las que se renderizaron, así que unas props nuevas los vuelven a montar cuando sus datos están listos (véase [Componentes que se montan más tarde](framework.md#componentes-que-se-montan-más-tarde)). Un snippet que el padre empieza o deja de pasar (`<snippet if:when>`, véase [Snippets condicionales](component-events.md#snippets-con-definesnippets)) llega al hijo montado como una prop nueva; sólo se reconstruyen los hijos que no reciben props reactivas: los que tienen ese `await` de datos y los compilados antes de `1.2`.
- **Snippets.** El contenido de un snippet pertenece al padre: sigue sus señales y los argumentos (`args`) que le pasa el hijo sin volver a pintarse, y no se reconstruye cuando cambian otras props del hijo.
- **SSR, hidratación y raíz.** No cambian: el servidor renderiza con el objeto de props y la hidratación conecta el mismo HTML. `hydrate(root, props)` y `hydrateScope` de un componente raíz reciben el objeto tal cual; sólo un padre Meeko entrega la vista reactiva a sus hijos.
- **HMR y DevTools.** Una actualización en caliente del hijo sigue leyendo las props que actualiza el padre, y el panel de DevTools muestra las props nuevas.

### Valores por defecto en `defineProps`

Los defaults están integrados en la misma macro; no se necesita `withDefaults`:

```html
<script lang="ts">
	interface Props {
		title: string
		count: number
		tags?: string[]
	}

	const props = defineProps<Props>({ count: 0, tags: [] })
</script>

<template><p>{props.title}: {props.count} ({props.tags.length})</p></template>
```

Para quien usa el componente, `count` y `tags` pasan a ser opcionales en `ComponentProps`; `title` sigue siendo obligatorio. Desde `1.8`, el editor muestra el valor por defecto en el hover de la etiqueta y de cada prop en el padre, y en el detalle del completado (`count?: number = 0`); el módulo compilado y sus declaraciones `.d.meeko.ts` lo llevan en el tipo `ComponentDefaults`. Dentro del componente, los tres valores tienen sus tipos definidos. Una prop explícita prevalece sobre su default; si llega como `undefined`, se aplica el default. El objeto literal se evalúa para cada render o hidratación: valores creados dentro, como `tags: []`, son nuevos por instancia; un objeto importado como default conserva la identidad compartida del módulo. SSR e hidratación deben obtener el mismo valor inicial: evite defaults no deterministas como `Date.now()` o `Math.random()` salvo que pase el valor como prop explícita.

El argumento debe ser un **objeto literal con propiedades nombradas**. Los valores pueden usar literales, símbolos importados y, desde `1.8`, constantes de nivel superior del `<script>` que no dependen del setup (véase [Constantes en los valores por defecto](#constantes-en-los-valores-por-defecto)); no otras variables del setup. Meeko comprueba que cada clave exista en `Props` y que su valor tenga el tipo declarado; rechaza claves duplicadas, spreads, nombres calculados, un default `undefined` y claves que no estén presentes en todas las variantes de una unión de props. `ComponentProps` conserva modificadores `readonly` y los campos específicos de cada variante. `defineProps<Props>()` permanece válido y conserva todas las props tal como se declararon.

La plantilla acepta texto `{expression}`, eventos `on:event="handler"`, atributos dinámicos `bind:name="expression"`, condiciones `if:when="expression"`, referencias `ref:name`, modelos `model="signal"` (véase [Controles de formulario con `model`](component-template.md#controles-de-formulario-con-model)), HTML sin escapar `html="expression"` (véase [HTML sin escapar con `html`](component-template.md#html-sin-escapar-con-html)) y listas con `each:of`, `each:as` y, opcionalmente, `each:key`. `each:index` nombra el índice y su valor predeterminado es `index`. Las claves son cadenas o números finitos y deben ser únicas entre hermanos. Los atributos booleanos se agregan o eliminan según el valor de la expresión. En los controles de formulario, `bind:value` (en `input`, `textarea` y `select`), `bind:checked` (en `input`) y `bind:selected` (en `option`) actualizan también la propiedad del elemento, porque el navegador deja de leer el atributo en cuanto el usuario edita el control. El control refleja siempre el signal, así que el manejador de `input` debe guardar el texto tal cual (`value.value = event.currentTarget.value`) y convertirlo donde se use. Un `select multiple` no se sincroniza con `bind:value`.

### Constantes en los valores por defecto

Los valores por defecto se evalúan antes del setup, una vez por render o hidratación. Desde `1.8` pueden leer constantes de nivel superior del `<script>` cuyo valor sólo usa literales, imports y otras constantes así; Meeko las vuelve a evaluar con los defaults, así que un objeto o un array sigue siendo nuevo por instancia:

```html
<script lang="ts">
	import { sizes } from '~/utils/sizes'

	const LIMITS = { min: 1, max: 10 } as const
	const START = LIMITS.min * 2
	const LABEL = `Hasta ${LIMITS.max}`

	const props = defineProps<{ count?: number; label?: string; size?: string }>({ count: START, label: LABEL, size: sizes[0] })
</script>
```

Una constante que depende del setup es el error `MEEK123`, que nombra la prop, la variable y el motivo: una señal o el valor de una llamada (`const start = signal(1)`, `const now = Date.now()`), una variable `let` o `var`, una función del script, una prop o un nombre de otra macro. Hasta `1.7`, cualquier variable del script daba `TS2304: Cannot find name`.

### Desestructurar las props

Desde `1.8`, `defineProps` puede desestructurarse, como en Vue 3.5. Cada nombre lee su prop allí donde se usa, así que sigue siendo reactivo en la plantilla, en un `computed`, en un `effect`, en los manejadores y en cualquier función:

```html
<script lang="ts">
	interface Props {
		label: string
		size?: 'sm' | 'md' | 'lg'
		tags?: string[]
		class?: string
		title?: string
	}

	const { label, size = 'md', tags = [], class: className, ...rest } = defineProps<Props>()
	const upper = computed(() => label.toUpperCase())
</script>

<template>
	<p
		bind:class="className"
		bind="rest"
	>
		{upper.value} · {size} · {tags.length}
	</p>
</template>
```

- **Lecturas reactivas.** El compilador escribe cada lectura de `label` como `props.label`, en el script y en la plantilla. Un parámetro, una variable local, un `each:as` o un parámetro de snippet con el mismo nombre es otra variable y no cambia. En el editor, el hover y el completado de `label` muestran su tipo, `meeko check` marca los errores sobre el nombre y renombrar `label` cambia sólo la variable local (`{ label: text }`), no la prop; la prop se renombra desde su tipo.
- **Valores por defecto.** `size = 'md'` equivale a `defineProps<Props>({ size: 'md' })`: la prop es opcional para el padre y nunca es `undefined` dentro; una prop que pasa a `undefined` vuelve a su default. Un objeto o un array (`tags = []`) se crea por instancia, y pueden usarse [constantes](#constantes-en-los-valores-por-defecto). Los defaults van en la desestructuración o en el argumento, no en los dos (`MEEK124`).
- **Renombrar.** `class: className` lee la prop `class` con otro nombre, útil para las palabras reservadas; también `'aria-label': ariaLabel`.
- **El resto.** `...rest` es una vista de sólo lectura de las demás props, que sigue al padre como `props`: `bind="rest"` escribe los atributos que tiene en cada momento. No incluye las props desestructuradas ni los manejadores de `defineEmits` (`onClick`).
- **Uniones.** Una unión discriminada se estrecha en el script y en la plantilla: dentro de `if:when="to !== undefined"`, `params` tiene los parámetros de esa rama, como en [Un botón que es ruta, enlace o botón](component-dynamic.md#un-botón-que-es-ruta-enlace-o-botón). Cada nombre desestructurado debe existir en todas las variantes; si no, `meeko check` da `TS2344` sobre él.
- **Sólo lectura.** Asignar un nombre desestructurado (`label = 'x'`, `count++`, también en un manejador de la plantilla) es el error `MEEK125`: es una prop. Para un valor propio que empieza con la prop, use `signal(label)`.
- **Lo que se lee una vez.** Copiar un nombre en el nivel superior del setup (`const copy = label`) o directamente en `onMounted` conserva el primer valor: `meeko check` da el aviso `MEEK101`, como con `props.label`. Lo mismo al expandir o desestructurar `rest` en el setup.
- **Formas no admitidas.** La desestructuración anidada (`const { user: { name } } = defineProps<Props>()`) daría una copia del valor interior que no sigue a la prop: es `MEEK015`; desestructure `user` y lea `user.name` donde lo use. También son `MEEK015` un array, una clave calculada y `let`.
- **SSR, hidratación y HMR.** No cambian: el estado de las señales se conserva igual que con `const props = defineProps<Props>()`.
