# Reactividad y ciclo de vida

## Reactividad

`signal(initial)` crea un valor editable con `.value`. `computed(() => expression)` crea un valor derivado de solo lectura. `effect(() => ...)` observa las señales leídas y devuelve una función que cancela el observador. `batch(() => ...)` agrupa actualizaciones; `untrack(() => ...)` lee sin suscribir el observador actual. `createRoot(dispose => ...)` agrupa efectos para liberarlos al desmontar una instancia. Si un observador falla, Meeko continúa los demás observadores pendientes y propaga los errores; varios fallos se entregan en un `AggregateError`. Si también falla el callback de `batch`, se conservan ambas causas.

El callback de `effect` debe ser síncrono: las lecturas posteriores a un `await` no pueden registrarse como dependencias de esa ejecución. TypeScript rechaza un callback que devuelve una promesa y el runtime rechaza el mismo caso en JavaScript; si esa promesa también rechaza, Meeko informa el rechazo para que no quede sin manejar. Inicie trabajo asíncrono desde un efecto síncrono y gestione explícitamente su cancelación y su error.

`onCleanup(() => ...)` registra la liberación de un recurso en la raíz activa y también exige un callback síncrono. TypeScript rechaza funciones que puedan devolver `PromiseLike`; el runtime protege JavaScript y callbacks que cambien de comportamiento, observa cualquier rechazo y entrega un `TypeError` durante la liberación. Todas las limpiezas continúan ejecutándose y los fallos simultáneos se agrupan. Para cerrar un recurso asíncrono, inicie y observe explícitamente esa operación antes del desmontaje o use un host que pueda esperar su propio ciclo de cierre.

Si el render o la hidratación falla, Meeko libera todos los efectos y recursos ya registrados. Cuando el trabajo y alguna limpieza fallan a la vez, entrega un `AggregateError` que conserva ambas causas.

### Ciclo de vida

`onMounted(fn)` (desde `1.1`) ejecuta `fn` una vez en el navegador, después de que el componente se hidrata o se monta y sus bindings y refs ya existen. Nunca se ejecuta en SSR. Llámelo mientras se ejecuta el script del componente; fuera de él lanza un error. Se exporta desde la raíz y se autoimporta en las aplicaciones del framework.

```html
<script lang="ts">
	const width = signal(0)
	onMounted(() => {
		const update = (): void => {
			width.value = window.innerWidth
		}
		update()
		window.addEventListener('resize', update)
		return () => window.removeEventListener('resize', update)
	})
</script>
<template><p>{width.value}px</p></template>
```

- **Orden.** Los callbacks se ejecutan al final de la hidratación o del montaje en curso, cuando ya existe todo lo que esa operación creó: el componente, sus hermanos posteriores y los bindings de su padre. Dentro de ella, los hijos ejecutan su `onMounted` antes que el padre. Un componente que se monta después (bajo un `if:`, en una fila nueva de `each:` o al confirmar una navegación) sigue la misma regla dentro de su propio montaje. Varios callbacks de un componente se ejecutan en el orden en que se registraron, sin suscribirse a las señales que leen. Si la hidratación o el montaje fallan, sus callbacks no se ejecutan, y tampoco los de un componente que se libera antes de que termine.
- **Limpieza.** Si `fn` devuelve una función, Meeko la registra como `onCleanup` y la ejecuta al desmontar el componente.
- **Asíncrono.** `fn` puede ser `async`, pero entonces no puede devolver una limpieza: llame `onCleanup` antes de su primer `await`.
- **Errores.** Un fallo síncrono o una promesa rechazada llega al observador más cercano con la fuente `"mounted"`, no detiene los demás callbacks y no deshace la hidratación.

No hay `onUpdated`: para reaccionar a cambios, use `effect`.

| Fase                                                 | Cuándo se ejecuta                                         | Dónde                                            |
| ---------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Setup (nivel superior del `<script>`)                | Al renderizar y al hidratar o montar                      | Servidor y navegador                             |
| `effect`                                             | Durante el setup y cada vez que cambia una señal que leyó | Servidor (sólo la primera ejecución) y navegador |
| `onMounted`                                          | Una vez, tras hidratar o montar                           | Sólo navegador                                   |
| `onCleanup` (y la limpieza que devuelve `onMounted`) | Al desmontar o liberar el componente                      | Donde se registró                                |

`createContext<T>()` crea una clave única tipada. `provide(key, value)` publica un valor en la instancia activa; `inject(key)` busca el proveedor más cercano y falla explícitamente si falta. Las raíces independientes no comparten valores. Si el valor es una señal, los descendientes pueden leerla reactivamente.

Los observadores creados durante `hydrate` pertenecen a esa instancia. Durante HMR de Vite se conservan por nombre las señales editables del script; los valores derivados se calculan otra vez. Este estado en memoria de HMR es independiente de la transferencia JSON entre servidor y navegador.

La raíz `@meekojs/meeko` exporta exactamente `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `onMounted`, `createContext`, `provide`, `inject`, `provideErrorHandler`, `serializeJson`, desde `1.3`, `trustHtml` y, desde `1.5`, `useId`, más los tipos de señales, contexto, componentes, `HotState`, DevTools y, desde `1.3`, `TrustedHtml`. Este motor documenta además `@meekojs/meeko/vite` y `@meekojs/meeko/devtools-ui`. Las subrutas del framework y de los adaptadores (`/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare` y `/build`) se describen en la [guía del framework](framework.md). El compilador importa sus funciones de DOM, HMR y registro de DevTools desde `@meekojs/meeko/internal`. Esa ruta es un contrato entre el compilador y su runtime de la **misma versión exacta**, y no está destinada a imports manuales. Un módulo generado debe compilarse con la misma versión del paquete que lo ejecuta, así que hay que volver a compilarlo al actualizar Meeko.


### IDs estables: `useId`

Desde `1.5`, `useId()` devuelve un ID para los atributos que enlazan elementos (`id`, `for`, `aria-describedby`, `aria-controls`, `aria-labelledby`): el mismo en el HTML del servidor y al hidratar, y distinto en cada instancia del componente. Se exporta desde la raíz y se autoimporta en las aplicaciones del framework; un export propio del proyecto con el mismo nombre tiene prioridad.

```html
<!-- app/components/AppSwitch.meeko -->
<script lang="ts">
	const props = defineProps<{ label: string; hint?: string }>()
	const on = defineModel<boolean>()
	const id = useId()
</script>
<template>
	<input
		type="checkbox"
		role="switch"
		bind:id="id"
		bind:aria-describedby="props.hint ? `${id}-hint` : null"
		model="on"
	/>
	<label bind:for="id">{props.label}</label>
	<p
		if:when="props.hint"
		bind:id="`${id}-hint`"
	>
		{props.hint}
	</p>
</template>
```

- **Determinista.** El ID no viaja en el estado: sale de la posición de la instancia en el árbol (el componente que la contiene, la clave de su fila en un `each:` y el `if:` o el snippet que la pintan) y del orden de la llamada en su script. El servidor y el navegador recorren las mismas posiciones, así que la hidratación encuentra el mismo `id` en cada atributo.
- **Único.** Dos instancias nunca comparten ID, tampoco las filas de una lista ni el contenido que un `if:` o un snippet pinta más tarde en el navegador. Una fila con `each:key` conserva su ID al reordenarse la lista, y un componente que un `if:` vuelve a crear recupera el que tenía.
- **Dónde llamarlo.** En el nivel superior del script, como `onMounted`, y antes de cualquier `await`. Cada llamada da un ID nuevo (`id` y `hint`, no uno para todo); para varios elementos de un mismo campo, derive sufijos de uno solo: `` `${id}-hint` ``. Fuera del script de un componente (en un manejador de eventos o en un test) devuelve un ID único que no coincide entre servidor y navegador.
- **Formato.** Prefijo de la aplicación, `-`, la posición y el contador: `m-0`, `m-2_f0n3-1`; una posición con claves de texto largas o con otros caracteres se resume en un hash (`m-h1x2y3…-0`). Sólo lleva letras, números, `-` y `_`, así que sirve también en un selector CSS. No dependa de su forma, que puede cambiar entre versiones.
- **Prefijo.** `document.idPrefix` de `meeko.config.ts` (una letra seguida de letras, números, `-` o `_`; `m` por defecto) lo cambia en el servidor y en el navegador a la vez. Distíngalo cuando dos aplicaciones Meeko compartan una página. Un host propio pasa el mismo valor en `DocumentOptions.config` y `mountClientApp({ document })`.
- **Raíces sueltas.** Con `hydrate` o `renderWithState` sin el framework, cada raíz empieza en la posición vacía: dos raíces independientes de la misma página repetirían sus IDs.

`useForm` lo usa para los IDs de [`form.field`](framework.md#componentes-de-campo-formfield).
