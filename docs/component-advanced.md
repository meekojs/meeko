# Composición y módulo generado

## Exponer valores: `defineExpose`

`defineExpose(value)` publica un valor del hijo para el padre que lo nombra con `ref:` (véase la sección siguiente). Es una sentencia de nivel superior que aparece una sola vez (`MEEK050`) y recibe un argumento y, como mucho, un argumento de tipo (`MEEK051`):

```html
<!-- SearchBox.meeko -->
<script lang="ts">
	const query = signal('')
	function clear(): void {
		query.value = ''
	}
	defineExpose({ query, clear })
</script>
<template>
	<input
		bind:value="query.value"
		on:input="(event) => query.value = event.currentTarget.value"
	/>
</template>
```

El padre recibe ese valor con su tipo; un componente sin `defineExpose` expone `null`. El módulo compilado exporta el tipo `ComponentExposed`, y la función que devuelve `hydrateScope` lleva el valor en `exposed`. El valor expuesto no forma parte del estado que se transfiere del servidor al navegador.

Las declaraciones `.d.meeko.ts` que genera `meeko types` pierden precisión en un componente con `defineExpose`: TypeScript no puede inferir allí todo el tipo del valor expuesto y escribe `any` en lo que no infiere. `meeko check` y el servidor de lenguaje compilan el componente y tienen el tipo exacto.

## Referencias a elementos: `ref:` y `useElementRef`

La directiva `ref:nombre`, sin valor, nombra un elemento o un componente de la plantilla. `useElementRef("nombre")` lo lee desde el script:

```html
<script lang="ts">
	const title = useElementRef('title')
	const box = useElementRef('box')
	onMounted(() => {
		title.value?.scrollIntoView()
	})
	function reset(): void {
		box.value?.clear()
	}
</script>
<template>
	<h2 ref:title>Buscar</h2>
	<SearchBox ref:box />
	<button on:click="reset">Limpiar</button>
</template>
```

- **Tipo.** Sale de la plantilla: en un elemento HTML o SVG, su tipo de `HTMLElementTagNameMap` o `SVGElementTagNameMap` (`HTMLHeadingElement` para `<h2>`); en un componente, el tipo de su `defineExpose`.
- **Sin `await`.** `useElementRef` devuelve una señal de sólo lectura que vale `null` en SSR, antes de hidratar, mientras un `if:` oculta el destino y después de liberarlo. Cuando se ejecuta `onMounted`, cada ref visible ya tiene su valor.
- **Con `await`.** `const title = await useElementRef("title")` devuelve el elemento, nunca `null`, y espera a que exista, también si está bajo un `if:` que todavía es falso. El resto del setup continúa sólo en el navegador (véase la sección siguiente).
- **Listas.** Dentro de `each:of`, una sola directiva nombra todas las filas y `useElementRef` devuelve una señal con un array de sólo lectura, en orden de documento. Una ref de lista no se puede esperar con `await` (`MEEK056`).

`useElementRef` recibe un literal de texto con el nombre de una `ref:` de la plantilla; otro argumento o un nombre inexistente da `MEEK056`. Una `ref:` con valor, con un nombre que no es un identificador, en `<template>` o repetida en el mismo elemento da `MEEK052`; el mismo nombre en dos lugares de la plantilla da `MEEK053`. El editor completa los nombres dentro de `useElementRef("…")`.

`ref="x"` y `bind:ref` no son directivas: se comportan como en `1.0`, como un atributo HTML en un elemento y, en un componente, `ref="x"` da `MEEK032` y `bind:ref` pasa una prop `ref`.

## Componentes genéricos (`generic`)

Desde `1.1`, el atributo `generic` del `<script lang="ts">` declara parámetros de tipo del componente. Su valor es una lista de parámetros de tipo de TypeScript, con restricciones (`extends`), valores por defecto y parámetros que dependen de otros (`generic="T extends object, K extends keyof T"`):

```html
<!-- DataTable.meeko -->
<script
	lang="ts"
	generic="T extends { id: string }"
>
	const props = defineProps<{ rows: T[] }>()
	const emit = defineEmits<{ select: [row: T] }>()
	const snippets = defineSnippets<{ row: [row: T] }>()
	const current = defineModel<T | null>('current', { default: null })
	defineExpose({ first: (): T | undefined => props.rows[0] })
</script>
<template>
	<ul>
		<li
			each:of="props.rows"
			each:as="row"
			each:key="row.id"
			on:click="() => emit('select', row)"
		>
			<render
				snippet="snippets.row"
				args="row"
			/>
		</li>
	</ul>
</template>
```

**Ámbito.** Los parámetros existen en todo el `<script>`: en los argumentos de tipo de `defineProps`, `defineEmits`, `defineModel` y `defineSnippets`, en el valor de `defineExpose` y en las anotaciones de variables y funciones. Las declaraciones `interface` y `type` del script, en cambio, se declaran a nivel de módulo, donde los parámetros no existen: una que usa `T` da `MEEK100`. Escriba el tipo en el argumento de la macro (`defineProps<{ rows: T[] }>()`) o declárelo genérico y pásele el parámetro (`type Rows<T> = T[]` y `defineProps<{ rows: Rows<T> }>()`).

**Inferencia en el padre.** El padre no escribe los argumentos de tipo: cada etiqueta los infiere una vez a partir de sus props.

```html
<DataTable
	bind:rows="users.value"
	on:select="(user) => open(user.email)"
	model:current="selected"
>
	<snippet
		name="row"
		params="user"
	>
		<span>{user.email}</span>
	</snippet>
</DataTable>
```

Con `users` de tipo `Signal<User[]>`, `T` es `User`. Con ese `T` se comprueban el resto de la etiqueta y lo que el padre recibe: el manejador de `on:select` recibe un `User`, `model:current` debe ser una `Signal<User | null>`, el parámetro `user` del snippet es un `User` y `useElementRef` de una `ref:` en la etiqueta devuelve el valor expuesto con `T = User`. Las props deben cumplir la restricción: filas sin `id` son un error de tipos en `bind:rows`. Los manejadores `on:` también son props (`onSelect`), así que uno con parámetros anotados participa en la inferencia; uno sin anotar recibe el `T` inferido. Una prop estática conserva su literal: con `generic="T extends string"`, `<Chip value="draft" />` infiere `T = "draft"`.

**Tipos.** El módulo compilado exporta `ComponentProps<T>`, `ComponentModels<T>`, `ComponentSnippets<T>` y `ComponentExposed<T>` con los mismos parámetros, restricciones y valores por defecto, y sus funciones `renderWithState`, `renderToString`, `hydrate` y `hydrateScope` son genéricas. Desde TypeScript, `ComponentProps<User>` da las props de una tabla de usuarios. Las declaraciones `.d.meeko.ts` de `meeko types` conservan los parámetros de tipo.

**Límites.**

- `T` sólo se infiere de las props. Los modelos, los snippets y las refs no participan: se comprueban con el `T` que dan las props, y si ninguna prop lo determina, TypeScript usa la restricción (o `unknown`).
- Una `ref:` en una etiqueta dentro de `each:of` tipa el valor expuesto de cada fila con la restricción de `T`, no con el `T` inferido.
- Desde `1.5`, `<component is>` admite contenido como snippets, igual que la etiqueta: un componente genérico con snippets obligatorios puede usarse con los dos. Hasta `1.4` no lo admitía (`MEEK031`), así que sólo podía usarse con su etiqueta.
- Las páginas, los layouts, `app/app.meeko` y `app/error.meeko` no pueden ser genéricos, porque Meeko les pasa sus props (véase [framework](framework.md#routing-layouts-y-ssr)). Tampoco un `<script server>` lleva `generic`.

`MEEK100` señala un `generic` vacío o que no es una lista de parámetros de tipo válida (también si cierra la lista antes de tiempo, como `generic="T> = string; type X<U"`), un parámetro con modificadores (`const`, `in`, `out`), con un nombre que empieza por `__` o repetido, `generic` en `<script server>` o en una página, un layout, `app.meeko` o `error.meeko`, y una declaración de tipo del script que usa un parámetro.

## Composables de nivel superior y `await`

`useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` sólo se llaman en el nivel superior del `<script>`; dentro de una función, un handler, un `effect` o `onMounted` dan `MEEK054`. `useState`, `useSocket`, `useSocketClient` y `useNavigation` mantienen su comportamiento de `1.0` y pueden llamarse también desde código anidado, igual que `useRoute` (véase [Ruta actual](framework.md#ruta-actual)), siempre que se ejecute con el componente: un composable que el script llama, un `computed`, un `effect` u `onMounted`. Un manejador de eventos, un temporizador o el callback de una promesa no tienen raíz activa: `useState` y `useRoute` lanzan `Missing Meeko context` o su propio error, `useSocket` y `useSocketClient` lanzan `onCleanup() requires an active component root` y `useNavigation` devuelve un estado fijo con `pending` en `false`. Llámalos en el script y usa el resultado en el manejador. `useForm` (desde `1.2`) tampoco da `MEEK054`, aunque su lugar es el nivel superior del script, como cualquier estado del componente (véase [Formularios: `useForm`](framework.md#formularios-useform)). `useHead` y `useSeoMeta` (desde `1.2`) no dan `MEEK054` y pueden llamarse dentro de un composable que el script invoca; fuera del script de un componente montado no hacen nada (véase [Head del documento](framework.md#head-del-documento-document-usehead-y-useseometa)). `useApi`, `useRpcQuery` y `useRpcMutation` pertenecen al framework y se describen en [framework.md](framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation).

Desde `1.2`, `useApiMutation` y `useStorage` necesitan que el script del componente se esté ejecutando (fuera de él lanzan un `Error`), pero el compilador no las incluye en `MEEK054`, para no rechazar funciones propias con el mismo nombre de proyectos anteriores. Llame a `useApiMutation` en el nivel superior, como `useRpcMutation`; `useStorage` puede llamarse también dentro de un composable que el script invoca. `await useApiMutation(...)` da `MEEK055`. Se describen en [Mutaciones](framework.md#mutaciones) y en [Estado persistente](framework.md#estado-persistente-usestorage).

El setup sigue siendo síncrono, con una excepción: admite `await` de nivel superior sólo sobre estos composables, y de dos clases.

| `await`                                                                          | Dónde se resuelve                                         | Resultado                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| `await useApi(...)`, `await useRpcQuery(...)`                                    | En el render del framework: SSR, hidratación y navegación | Los datos cargados, con `data` no nulo   |
| `await useElementRef(...)`, `await useSocket(...)`, `await useSocketClient(...)` | Sólo en el navegador, tras montar                         | El elemento, o el socket una vez abierto |

El `await` debe ser la sentencia completa o el inicializador completo de una declaración (`const notes = await useApi(...)`), con uno por sentencia. Cualquier otro `await` de nivel superior, `await useRpcMutation(...)`, `for await` y `await using` dan `MEEK055`; lleve ese trabajo a una función o a `onMounted`.

Sin `await`, `useApi` y `useRpcQuery` devuelven el recurso enseguida, con `data` en `null` hasta que la petición, que empieza en el navegador al montar, termina. Su zona sale vacía en el HTML del servidor y crece al llegar los datos; desde `1.5`, `<MeekoAwait for="recurso" reserve>` la envuelve con sus estados y reserva su altura (véase [Evitar saltos de altura](framework.md#evitar-saltos-de-altura-cls)).

El primer `await` de navegador divide el setup:

- Las sentencias anteriores son el setup normal, que se ejecuta en SSR y al hidratar. La plantilla sólo puede usar nombres declarados ahí: un nombre declarado después da `MEEK057`.
- Desde ese `await`, el resto es una continuación que sólo se ejecuta en el navegador, una vez montado el componente y listo lo que espera. Pertenece al componente: sus `effect`, `onCleanup` y composables se liberan al desmontarlo, y si se desmonta mientras espera, la continuación no se reanuda. Un fallo llega al observador de errores con la fuente `"mounted"`.
- `defineProps`, `defineEmits`, `defineExpose`, `defineModel` y `defineSnippets` deben ir antes de ese `await` (`MEEK058`).
- Un `await useApi(...)` o `await useRpcQuery(...)` posterior se ejecuta también sólo en el navegador, como una petición normal.
- La continuación es una función asíncrona y admite las mismas sentencias que el setup síncrono: declaraciones `const`/`let` simples y funciones, cualquier sentencia de expresión (asignaciones como `count.value = 1`, no sólo llamadas), `if`, `for`, `for...of`, `for...in`, `while`, `do...while`, `try`, `switch`, bloques, sentencias etiquetadas y sentencias vacías. `useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` dentro de una de esas sentencias de control se ejecutarían de forma condicional o repetida y dan `MEEK054`. Cualquier otra sentencia (una clase, `export const`…) da `MEEK018`.

`await useElementRef("x")` espera el valor del `defineExpose` del componente que nombra `ref:x`. Si ese componente no tiene `defineExpose`, no hay nada que esperar: `meeko check` lo marca con `MEEK080` (el editor lo muestra como un error de tipos de `await`) y, en ejecución, la promesa rechaza con un error `MEEK080` cuando el componente se hidrata. Añada `defineExpose` al componente o lea `useElementRef("x").value` sin `await`.

```html
<script lang="ts">
	const messages = signal<string[]>([])
	const chat = await useSocket('chat', { roomId: 'general' })
	// Desde aquí, sólo en el navegador y con el socket abierto.
	chat.on('message', (message) => {
		messages.value = [...messages.value, message.text]
	})
</script>
<template>
	<p
		each:of="messages.value"
		each:as="text"
	>
		{text}
	</p>
</template>
```

## Módulo generado

Cada `.meeko` exporta `ComponentProps`, `ComponentEmits` (desde `1.8`; el mapa de `defineEmits`, y `{}` sin él), `ComponentExposed` (desde `1.1`; `null` sin `defineExpose`), los tipos `ComponentModels` y `ComponentSnippets` (desde `1.1`; `null` sin `defineModel` o sin `defineSnippets`), `css`, `renderWithState(props)`, `renderToString(props)`, `hydrate(root, props, state?)` y `hydrateScope(scope, props, state?)`; en un componente con `generic`, esos tipos y funciones llevan sus parámetros de tipo (véase [Componentes genéricos](#componentes-genéricos-generic)). Con `defineEmits`, `ComponentProps` incluye las props de callback opcionales de cada evento (`onSave`). La aplicación entrega las mismas props serializables al servidor y al navegador. `renderWithState` devuelve HTML y una captura de señales editables validada como JSON; `hydrate` restaura esos valores antes de reclamar el HTML existente. Los hijos transportan su propio estado dentro de sus marcadores de comentarios. `hydrateScope` lo usa el compilador para esos hijos. La función de limpieza libera observadores y eventos. Una diferencia en el HTML inicial produce un error de hidratación.

```ts
import { hydrate, renderWithState } from './Counter.meeko'
import { serializeJson } from '@meekojs/meeko'

const props = { initial: 1 }
const { html, state } = renderWithState(props)
const payload = serializeJson({ props, state })
// El servidor inserta html en la raíz y payload en un script JSON seguro.
const release = hydrate(document.querySelector('#counter')!, props, state)
// Llamar release() cuando la raíz deje de usarse.
```

Desde `1.4`, cada componente autoimportado también tiene esos tipos con su nombre de etiqueta, sin import: `<AppCard>` (`app/components/App/Card.meeko`; desde `1.8`, `Button/Index.meeko` es `<Button>`, véase [Una carpeta con `Index.meeko`](framework.md#carpeta-con-index)) da `AppCardProps`, sus props sin callbacks (desde `1.8`; véase [Envolver otro componente](#envolver-otro-componente)), `AppCardEmits` (desde `1.8`), `AppCardSnippets`, `AppCardModels` y `AppCardExposed`, que son exactamente su `ComponentEmits`, `ComponentSnippets`, `ComponentModels` y `ComponentExposed`, `null` incluido (véase [Tipos de cada componente](framework.md#tipos-de-cada-componente)). El módulo `.meeko` no los exporta con ese nombre, porque el nombre depende de dónde lo autoimporta el proyecto (carpeta y prefijo de módulo), no del componente: desde un import explícito siguen siendo `import type { ComponentSnippets as CardSnippets } from "./Card.meeko"`.

<a id="envolver-otro-componente"></a>**Envolver otro componente.** Desde `1.8`, un componente autoimportado tiene tres tipos para esto:

| Tipo                           | Qué es                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| `BaseButtonProps`              | Sus props, sin los callbacks de `defineEmits`.                            |
| `BaseButtonEmits`              | El mapa de `defineEmits`, para escribir `defineEmits<BaseButtonEmits>()`. |
| `ComponentProps<"BaseButton">` | Todo lo que puede pasar el padre, incluidos los `onClick`.                |

Un envoltorio extiende las props, declara los eventos y reenvía el resto. Si las props del otro componente son una unión, como una ruta, un enlace o un botón, las variantes se conservan: pasar a la vez `to` y `href` sigue siendo un error en el padre del envoltorio.

```html
<script lang="ts">
  type Props = BaseButtonProps & { label: string }

  const { label, ...rest } = defineProps<Props>()
  const emit = defineEmits<BaseButtonEmits>()
</script>

<template>
  <BaseButton bind="rest" on:click="(event) => emit('click', event)">{label}</BaseButton>
</template>
```

`bind` no admite claves `on*` (`MEEK113`), y por eso el evento se reenvía con `on:click`. `on:click` llega al hijo como la prop `onClick`: ésa es la razón de que `ComponentProps` los incluya. Con una unión hay que escribir un `type`, como en el ejemplo: `interface Props extends BaseButtonProps` es `TS2312`, porque una interfaz tiene una sola forma; con unas props que son un objeto, las dos formas valen.

Un mapa que el script no escribe, como `defineEmits<BaseButtonEmits>()`, deja fuera de la enumeración de `props` y del resto toda clave `onX`, porque el compilador no conoce los nombres; leer `props.onX` sigue funcionando.

Desde `1.5`, una señal del script que vale `undefined` viaja en el estado de `renderWithState` (bajo la clave `"meeko:undefined"`, que lista sus nombres) y se hidrata como `undefined`, aunque el script del navegador la cree con otro valor. Un valor que JSON no representa fielmente (una fecha, un `Map`, una instancia de clase o un `undefined` dentro de un objeto) falla con el componente y la señal, y una pista: `app/pages/agenda.meeko: the signal "when" cannot be sent to the browser with the SSR state (Non-plain object at $.when)`. Sólo viajan las señales editables del nivel superior del script: un `computed`, una constante o una señal guardada dentro de un objeto no forman parte del estado.

Para transferir props o estado en una etiqueta `<script>`, usa `serializeJson(value)`; comprueba que el dato pueda representarse fielmente en JSON y escapa caracteres que podrían cerrar la etiqueta. `renderToString` sigue disponible cuando el estado inicial se deriva de forma determinista de las props y no se necesita una captura explícita. `renderToString` y `renderWithState` son síncronos: fuera del render del framework no pueden esperar un `await useApi(...)` o `await useRpcQuery(...)`, y un componente que lo necesita lanza un error con el código `MEEKO_SUSPENDED`. Use el componente desde una página del framework o use el composable sin `await`. Dentro del framework, un componente que se monta en el navegador después de la página espera sus datos con la zona vacía en lugar de lanzar ese error (véase [Componentes que se montan más tarde](framework.md#componentes-que-se-montan-más-tarde)). Los módulos compilados exportan además `hasDataAwait` y `__meekoChildren`, marcas que el framework lee para saltarse la carga previa de una navegación, `__meekoReactiveProps` (desde `1.2`), que indica al padre que puede actualizar las props del hijo sin volver a montarlo, y `__meekoChannels` y `__meekoTag`, que sólo tipan las etiquetas del padre; ninguna forma parte del contrato. Al cambiar las props de un hijo, Meeko actualiza en su sitio los bindings que las leen (véase [Props reactivas](component-basics.md#props-reactivas)); cuando el hijo se vuelve a montar, conserva sus señales editables por nombre.
