/**
 * The syntax of a `.meeko` file that is not an export of the package: blocks, compiler macros,
 * built-in tags and template directives. Their text summarizes `docs/api.md` and
 * `docs/framework.md`, checked against the compiler; the generator adds what the source already
 * documents: the JSDoc that the editor shows for each macro (`src/language-server/model.ts`), the
 * documentation of `html`, and the one-line detail of each directive and attribute that the editor
 * completes (`src/language-server/features.ts`).
 */

/** Kind of a syntax entry. */
export type BuiltinKind = 'block' | 'macro' | 'tag' | 'directive'

/** An attribute of a tag or one of the names of a directive. */
export interface BuiltinAttribute {
	readonly name: string
	/** How it is written, such as `each:key="expresión"`. */
	readonly syntax: string
	/** Used when the editor has no detail for `name`. */
	readonly description?: string
}

/** A page of the syntax of `.meeko`. */
export interface BuiltinEntry {
	/** Display name, such as `defineProps`, `<MeekoLink>` or `if:when`. */
	readonly name: string
	readonly slug: string
	readonly kind: BuiltinKind
	/** Code shown as its signature: how it is written. */
	readonly signature: string
	readonly signatureLang: 'ts' | 'meeko'
	/**
	 * Markdown description. For a macro, the JSDoc of the editor (`macroDocs`) comes first and this
	 * text, if any, follows it.
	 */
	readonly description?: string
	readonly since?: string
	/** Markdown examples with fenced code; a macro adds the one of its JSDoc first. */
	readonly examples?: readonly string[]
	readonly attributes?: readonly BuiltinAttribute[]
	/** Documents of the repository with anchor, such as `docs/api.md#props-reactivas`. */
	readonly see: readonly string[]
	/** Names of related pages: exports or other syntax entries. */
	readonly related?: readonly string[]
	/** Where the compiler handles it: file from the repository root and a text of the line. */
	readonly source: { readonly file: string; readonly match: string }
	/** Inline code of the guides that links to this page, besides its name. */
	readonly aliases?: readonly string[]
}

const compiler = 'packages/meeko/src/compiler.ts'

export const builtins: readonly BuiltinEntry[] = [
	// Blocks of the component.
	{
		name: '<script server>',
		slug: 'script-server',
		kind: 'block',
		signatureLang: 'meeko',
		signature: ['<script server lang="ts">', 'export const route = definePage({ params, search, render, prerenderEntries, load, head })', '', 'const { params, search, context } = usePage()', 'export const datos = await cargar(params)', 'export const head = { title: "…", description: "…" }', '</script>'].join('\n'),
		description: [
			'El código de servidor de una página de `app/pages`, en el propio `.meeko`. Nunca forma parte del componente: se ejecuta en el servidor con los autoimports de `server/utils` y puede importar `server/` y módulos `*.server.*`.',
			'',
			'El bloque admite dos formas, que pueden convivir salvo `load` junto a código de nivel superior (`MEEK070`):',
			'',
			'- **Código de nivel superior** (desde `1.1`). Se ejecuta en cada petición, en SSR y en la petición de datos de cada navegación cliente, después del middleware y de validar `params` y `search`. Admite `await` de nivel superior. Cada `export const` o `export let` salvo `route` y `head` es un dato de la página que llega tipado al `<script>` y a la plantilla, de sólo lectura; viaja en JSON y `meeko check` rechaza lo que no se puede serializar.',
			'- **Opciones de ruta.** `export const route = definePage({ ... })`, como un sidecar `*.route.ts`. `render` debe ser un literal que `meeko build` pueda leer sin ejecutarlo.',
			'',
			'`usePage()`, `redirect(url, status?)` y `notFound()` se usan sin import en el nivel superior del bloque; fuera de él dan `MEEK073`. `export const head` fija el `<head>` de la página como `route.head`; declarar ambos da `MEEK072`.',
			'',
			'Sólo va en páginas: en un componente, un layout, `+layout.meeko` o `+error.meeko` da `MEEK044`. Un segundo bloque da `MEEK004`, sin `lang="ts"` da `MEEK006` y con un valor (`server="..."`) da `MEEK043`. Con `render: "client"` el bloque es público y entra en el bundle del navegador; el código de nivel superior da entonces `MEEK074`.',
			'',
			'Cada API tiene su sitio (desde `1.3`). En el `<script>` y la plantilla del componente, que también se ejecutan en el navegador, un autoimport de servidor (`defineApiRoute`, `ApiError`, los de `server/utils`…), un import de valores de `@meekojs/meeko/server` y un import de `server/` o de `*.server.*` dan `MEEK108`; `definePage` no tiene efecto allí y da el aviso `MEEK109`. A la inversa, las macros del componente (`defineProps`, `defineEmits`…) y `onMounted` dan `MEEK108` dentro de `<script server>`.',
		].join('\n'),
		examples: [['```html', '<!-- app/pages/users/[id].meeko -->', '<script server lang="ts">', 'import { definePage } from "@meekojs/meeko/framework";', 'import * as v from "valibot";', '', 'export const route = definePage({ params: v.object({ id: v.string() }) });', '', 'const { params, context } = usePage();', 'if (!context.session.current) redirect("/login");', 'const row = await db.users.findById(params.id);', 'if (!row) notFound();', 'export const user = { id: row.id, name: row.name };', 'export const head = { title: `Perfil de ${user.name}` };', '</script>', '', '<script lang="ts">', 'const name = signal(user.name);', '</script>', '', '<template><h1>{user.name}</h1><input model="name"></template>', '```'].join('\n')],
		see: ['docs/framework.md#código-de-servidor-de-la-página', 'docs/framework.md#reglas-comunes', 'docs/framework.md#dónde-se-usa-cada-api', 'docs/framework.md#modos-de-render'],
		related: ['definePage', 'usePage', 'redirect', 'notFound', 'useHead'],
		source: { file: 'packages/meeko/src/compiler/server-script.ts', match: 'export function analyzeServerScript(' },
		aliases: ['<script server lang="ts">'],
	},
	{
		name: 'generic',
		slug: 'generic',
		kind: 'block',
		since: '1.1.0',
		signatureLang: 'meeko',
		signature: '<script lang="ts" generic="T extends object, K extends keyof T">',
		description: [
			'Atributo del `<script lang="ts">` que declara parámetros de tipo del componente. Su valor es una lista de parámetros de tipo de TypeScript, con restricciones (`extends`), valores por defecto y parámetros que dependen de otros.',
			'',
			'- **Ámbito.** Los parámetros existen en todo el `<script>`: en los argumentos de tipo de `defineProps`, `defineEmits`, `defineModel` y `defineSnippets`, en el valor de `defineExpose` y en las anotaciones. Las declaraciones `interface` y `type` del script se declaran a nivel de módulo, donde no existen: una que usa `T` da `MEEK100`.',
			'- **Inferencia en el padre.** El padre no escribe los argumentos de tipo: cada etiqueta los infiere una vez a partir de sus props, y con ese `T` se comprueban sus eventos, modelos, snippets y refs.',
			'- **Tipos.** El módulo compilado exporta `ComponentProps<T>`, `ComponentModels<T>`, `ComponentSnippets<T>` y `ComponentExposed<T>` con los mismos parámetros.',
			'- **Límites.** `T` sólo se infiere de las props. Las páginas, los layouts, `app/app.meeko`, `app/error.meeko` y `<script server>` no pueden ser genéricos (`MEEK100`).',
		].join('\n'),
		examples: [['```html', '<!-- DataTable.meeko -->', '<script lang="ts" generic="T extends { id: string }">', 'const props = defineProps<{ rows: T[] }>();', 'const emit = defineEmits<{ select: [row: T] }>();', 'const snippets = defineSnippets<{ row: [row: T] }>();', '</script>', '<template>', '  <ul>', '    <li each:of="props.rows" each:as="row" each:key="row.id" on:click="() => emit(\'select\', row)">', '      <render snippet="snippets.row" args="row" />', '    </li>', '  </ul>', '</template>', '```', '', 'Con `users` de tipo `Signal<User[]>`, el padre infiere `T = User`:', '', '```html', '<DataTable bind:rows="users.value" on:select="(user) => open(user.email)">', '  <snippet name="row" params="user"><span>{user.email}</span></snippet>', '</DataTable>', '```'].join('\n')],
		see: ['docs/api.md#componentes-genéricos-generic'],
		related: ['defineProps', 'defineEmits', 'defineSnippets', 'defineModel', 'defineExpose'],
		source: { file: 'packages/meeko/src/compiler/generic.ts', match: 'export function parseGeneric(' },
	},
	{
		name: '<style>',
		slug: 'style',
		kind: 'block',
		signatureLang: 'meeko',
		signature: ['<style>', '.markdown-view p { … }', '</style>'].join('\n'),
		description: [
			'Estilos globales que viven junto al componente. Sin `scoped`, el bloque pasa por el mismo PostCSS que `app/styles/main.css` y se aplica a **toda la página**, no sólo a la plantilla del componente: alcanza a los hijos y al contenido de `html="..."`, y una `.card` de este bloque afecta a la `.card` de cualquier otro componente.',
			'',
			'Vite lo empaqueta con el componente: el SSR lo enlaza en las páginas que usan el componente y la navegación cliente lo carga con su ruta. Una vez cargado sigue aplicándose al navegar a otras rutas, y su orden frente a otras hojas depende de cuándo se cargó. `:global(...)` sólo se transforma en `<style scoped>`; aquí llegaría tal cual al navegador.',
			'',
			'Úselo para estilos globales a propósito, con un prefijo propio. Para lo demás, `<style scoped>` con `:global(...)` alcanza a hijos y contenido de `html` sin perder el ámbito, y los estilos de toda la aplicación van mejor en `app/styles/main.css`.',
		].join('\n'),
		examples: [['```html', '<!-- MarkdownView.meeko -->', '<template>', '  <article class="markdown-view" html="props.content"></article>', '</template>', '', '<style>', '  /* Global a propósito: el prefijo .markdown-view evita afectar al resto. */', '  .markdown-view p { margin-block: 0.75em; }', '  .markdown-view pre { overflow-x: auto; }', '</style>', '```'].join('\n')],
		see: ['docs/api.md#estilos-del-componente-style-y-style-scoped'],
		related: ['<style scoped>', 'html'],
		source: { file: compiler, match: 'function scopeCss(' },
	},
	{
		name: '<style scoped>',
		slug: 'style-scoped',
		kind: 'block',
		signatureLang: 'meeko',
		signature: ['<style scoped>', '.card :global(.icon) { … }', '</style>'].join('\n'),
		description: [
			'Estilos con ámbito del componente. `<style scoped>` añade el atributo `data-meeko-s-<hash>` al último compuesto de cada selector, antes de un pseudoelemento si lo hay (`.card::before` se convierte en `.card[data-meeko-s-…]::before`). Las reglas dentro de `@keyframes` no se modifican.',
			'',
			'`:global(<selector>)` emite el selector interno sin el atributo de ámbito: `.card :global(.icon)` da `.card[data-meeko-s-…] .icon` y `:global(html.dark)` queda sin atributo. `:global` sin paréntesis o vacío, una lista de selectores dentro de `:global(...)` y un `:global(...)` anidado en otra pseudoclase fallan con `MEEK019`.',
			'',
			'El contenido de `html="..."` y los elementos de un componente hijo no reciben el atributo del padre: selecciónelos con `:global(...)`. Desde `1.2`, `css.scopeAttribute: "matched"` de `meeko.config.ts` pone el atributo sólo en los elementos que algún selector con ámbito puede seleccionar; el valor por defecto en `1.x` es `"all"`.',
		].join('\n'),
		examples: [['```html', '<template>', '  <section class="card">', '    <h2 class="title">Título</h2>', '    <div class="content" html="body.value"></div>', '  </section>', '</template>', '', '<style scoped>', '.card .title { font-weight: 700; }', '.content :global(p) { margin: 0; }', '</style>', '```'].join('\n')],
		see: ['docs/api.md#estilos-con-ámbito-y-global', 'docs/api.md#qué-elementos-reciben-el-atributo'],
		related: ['<style>', 'html', 'defineMeekoConfig'],
		source: { file: compiler, match: 'function scopeCss(' },
		aliases: [':global(...)', ':global(<selector>)'],
	},

	// Compiler macros: their description, `@since` and first example come from the editor's JSDoc.
	{
		name: 'defineProps',
		slug: 'defineprops',
		kind: 'macro',
		signatureLang: 'ts',
		signature: ['const props = defineProps<Props>()', 'const props = defineProps<Props>({ count: 0, tags: [] })'].join('\n'),
		description: ['`props` es una vista de sólo lectura de las props actuales: desde `1.2`, cada lectura de `props.x` en la plantilla, en un `computed` o en un `effect` sigue a la prop cuando el padre la cambia, sin volver a montar el hijo. Un valor que la copia en el setup (`const { label } = props`) conserva el inicial; `meeko check` lo avisa con `MEEK101`. Asignar una propiedad de `props` en el navegador lanza `TypeError`.', '', 'El argumento de defaults debe ser un objeto literal con propiedades nombradas; sus claves deben existir en `Props` y sus valores, tener el tipo declarado. Se evalúa en cada render o hidratación, así que un default creado dentro (`tags: []`) es nuevo por instancia.'].join('\n'),
		see: ['docs/api.md#valores-por-defecto-en-defineprops', 'docs/api.md#props-reactivas'],
		related: ['defineEmits', 'defineModel', 'Component'],
		source: { file: compiler, match: 'function definePropsCall(' },
	},
	{
		name: 'defineEmits',
		slug: 'defineemits',
		kind: 'macro',
		signatureLang: 'ts',
		signature: ['const emit = defineEmits<{ save: [id: number]; close: [] }>()', "emit('save', 42)"].join('\n'),
		description: 'Cada evento `save` es la prop de callback opcional `onSave` del hijo, así que `on:save="save"` equivale a `bind:onSave="save"`. Las props que declara `defineEmits` no pueden declararse también en `defineProps`. En un componente, el nombre del evento es un identificador: `on:save-draft` da `MEEK011`.',
		see: ['docs/api.md#eventos-de-componente-defineemits-y-on'],
		related: ['on:evento', 'defineProps'],
		source: { file: 'packages/meeko/src/compiler/emits.ts', match: 'export function analyzeEmits(' },
	},
	{
		name: 'defineModel',
		slug: 'definemodel',
		kind: 'macro',
		signatureLang: 'ts',
		signature: ['declare function defineModel<T>(options?: { readonly default: T }): Signal<T>', 'declare function defineModel<T>(name: string, options?: { readonly default: T }): Signal<T>'].join('\n'),
		description: 'Los modelos no son props: no aparecen en `ComponentProps` y el módulo compilado exporta su tipo en `ComponentModels`. La señal que pasa el padre no forma parte del estado que el hijo transfiere en SSR ni del que conserva en HMR. Las opciones sólo admiten `default` (`MEEK064`).',
		see: ['docs/api.md#modelos-de-componente-definemodel-y-model'],
		related: ['model', 'Signal', 'signal'],
		source: { file: 'packages/meeko/src/compiler/models.ts', match: 'export function analyzeModels(' },
	},
	{
		name: 'defineSnippets',
		slug: 'definesnippets',
		kind: 'macro',
		signatureLang: 'ts',
		signature: 'const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>()',
		description: ['Cada snippet es un `Snippet<Args>`. Los snippets no son props: no aparecen en `ComponentProps` y el módulo compilado exporta su tipo en `ComponentSnippets`. No pasar un snippet obligatorio, pasar uno que el hijo no declara o usar parámetros que no coinciden con su tupla son errores de tipos en el padre. Recibe un argumento de tipo y ningún argumento en tiempo de ejecución (`MEEK060`).', '', 'Desde `1.4`, el valor de una clave también puede ser un `Snippet<Args>`, que cuenta como `Args`: `T` puede partir de los snippets de otro componente, `AppCardSnippets` (el tipo con nombre de cada componente autoimportado) o el `ComponentSnippets` de su módulo, recortados o ampliados con `Omit`, `Pick` o `&`. Cada snippet conserva sus parámetros y su `?`, y las declaraciones con tuplas no cambian.'].join('\n'),
		examples: [['```html', '<!-- app/components/App/Modal.meeko: reutiliza los snippets de <AppCard> salvo footer -->', '<script lang="ts">', 'const open = defineModel<boolean>();', 'const snippets = defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>();', 'function close(): void {', '  open.value = false;', '}', '</script>', '<template>', '  <AppCard>', '    <snippet name="header" if:when="snippets.header"><render snippet="snippets.header" /></snippet>', '    <render snippet="snippets.default" />', '    <snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet>', '  </AppCard>', '</template>', '```'].join('\n')],
		see: ['docs/api.md#snippets-con-definesnippets', 'docs/framework.md#tipos-de-cada-componente'],
		related: ['<snippet>', '<render>', 'Snippet'],
		source: { file: 'packages/meeko/src/compiler/snippets.ts', match: 'export function analyzeSnippets(' },
	},
	{
		name: 'defineExpose',
		slug: 'defineexpose',
		kind: 'macro',
		signatureLang: 'ts',
		signature: 'declare function defineExpose<T>(exposed: T): T',
		description: 'El módulo compilado exporta el tipo `ComponentExposed`, y la función que devuelve `hydrateScope` lleva el valor en `exposed`. Las declaraciones `.d.meeko.ts` de `meeko types` pierden precisión en un componente con `defineExpose`; `meeko check` y el servidor de lenguaje tienen el tipo exacto.',
		see: ['docs/api.md#exponer-valores-defineexpose'],
		related: ['useElementRef', 'ref:nombre'],
		source: { file: 'packages/meeko/src/compiler/expose.ts', match: 'export function analyzeExpose(' },
	},
	{
		name: 'useElementRef',
		slug: 'useelementref',
		kind: 'macro',
		signatureLang: 'ts',
		signature: ["const title = useElementRef('title') // señal de sólo lectura, null en SSR", "const field = await useElementRef('field') // el elemento; sigue sólo en el navegador"].join('\n'),
		description: '`await useElementRef("x")` sobre un componente sin `defineExpose` no tiene nada que esperar: `meeko check` lo marca con `MEEK080`. Los nombres declarados después de su `await` sólo existen en el navegador y la plantilla no puede leerlos (`MEEK057`).',
		see: ['docs/api.md#referencias-a-elementos-ref-y-useelementref', 'docs/api.md#composables-de-nivel-superior-y-await'],
		related: ['ref:nombre', 'defineExpose', 'ReadonlySignal', 'onMounted'],
		source: { file: 'packages/meeko/src/compiler/composables.ts', match: 'export function analyzeComposables(' },
	},

	// Built-in tags.
	{
		name: '<MeekoLink>',
		slug: 'meekolink',
		kind: 'tag',
		since: '1.2.0',
		signatureLang: 'meeko',
		signature: '<MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: \'perfil\' }">Perfil</MeekoLink>',
		description: ['Renderiza un `<a>` cuyo `href` construye `href()`: `to` sólo admite rutas que existen, las rutas dinámicas exigen `bind:params` con sus claves y `bind:search` añade la query string. `meeko check` y el editor marcan una ruta inexistente en el atributo. No se importa: el compilador la reconoce.', '', 'En la ruta activa (la misma ruta sin query ni fragmento) añade `aria-current="page"`, que la navegación actualiza. El resto de atributos y los hijos pasan al `<a>` tal cual: `class`, `target`, `rel`, `aria-*`, `data-*` y `on:click`. `href` y `bind:href` no se admiten, porque el enlace lo construye `to` (`MEEK105`).'].join('\n'),
		attributes: [
			{ name: 'to', syntax: 'to="/users/[id]"' },
			{ name: 'bind:params', syntax: 'bind:params="{ id: user.id }"' },
			{ name: 'bind:search', syntax: 'bind:search="{ tab: \'perfil\' }"' },
		],
		examples: [['```html', '<!-- app/layouts/default.meeko -->', '<template>', '  <header>', '    <MeekoLink to="/" class="brand">Inicio</MeekoLink>', '    <MeekoLink to="/users/[id]" bind:params="{ id: session.userId }">Mi perfil</MeekoLink>', '  </header>', '  <main><MeekoOutlet /></main>', '</template>', '', '<style scoped>', 'a[aria-current="page"] { font-weight: 700; }', '</style>', '```'].join('\n')],
		see: ['docs/framework.md#meekooutlet--y-meekolink'],
		related: ['href', '<MeekoOutlet />', 'useRoute'],
		source: { file: compiler, match: 'const linkTag = "MeekoLink"' },
		aliases: ['<MeekoLink>', 'MeekoLink'],
	},
	{
		name: '<MeekoOutlet />',
		slug: 'meekooutlet',
		kind: 'tag',
		since: '1.2.0',
		signatureLang: 'meeko',
		signature: '<MeekoOutlet />',
		description: ['Pinta, en `app/app.meeko` y en los layouts (`app/layouts/*.meeko` o `+layout.meeko`), el layout o la página que van dentro. Lee el `outlet` que Meeko pasa, así que el layout no necesita declarar `defineProps<{ outlet }>()`; si declara sus props, `outlet` debe estar entre ellas. No se importa: el compilador la reconoce.', '', 'Equivale a `<component is="props.outlet">`: el navegador conserva el layout entre rutas y sólo cambia lo que hay dentro. En otro componente, o con atributos o contenido, da `MEEK104`.'].join('\n'),
		examples: [['```html', '<!-- app/app.meeko -->', '<template>', '  <div class="site-root"><MeekoOutlet /></div>', '</template>', '```'].join('\n')],
		see: ['docs/framework.md#meekooutlet--y-meekolink', 'docs/framework.md#routing-layouts-y-ssr'],
		related: ['<component is>', '<MeekoLink>', 'Component'],
		source: { file: compiler, match: 'const outletTag = "MeekoOutlet"' },
		aliases: ['<MeekoOutlet />', '<MeekoOutlet>', 'MeekoOutlet'],
	},
	{
		name: '<MeekoThemeToggle>',
		slug: 'meekothemetoggle',
		kind: 'tag',
		since: '1.4.0',
		signatureLang: 'meeko',
		signature: ['<MeekoThemeToggle mode="cycle" bind:themes="[\'light\', \'dark\', \'system\']" bind:labels="{ dark: \'Oscuro\' }" class="toggle">', '  <snippet name="dark"><IconMoon /></snippet>', '</MeekoThemeToggle>'].join('\n'),
		description: ['Selector del tema claro/oscuro, con `theme` en `meeko.config.ts`; sin `theme` es el error `MEEK111`. No se importa: el compilador la reconoce, y un componente del proyecto con el mismo nombre tiene prioridad (`MEEK106`).', '', '`mode="cycle"` (por defecto) es un botón que pasa a la elección siguiente, con un `aria-label` como «Tema: oscuro. Cambiar a sistema» («Cambiar tema» mientras la página no conoce la elección); `mode="select"` es un grupo de radios que se maneja con las flechas. Cada snippet (`light`, `dark`, `system` o un tema propio) es el icono de esa elección; sin snippet se pinta su nombre. `meeko check` tipa los snippets, `themes` y `labels` con los temas de la configuración.', '', 'Pinta todos los iconos, cada uno en `<span data-meeko-theme-icon>`, y una regla que Meeko añade a `<head>` muestra el de `data-theme-choice` de `<html>`, que el script del tema escribe antes del primer pintado: el icono nunca salta. Sin JavaScript es un `<form>` que envía `POST /_meeko/theme`, que comprueba el tema y el `Origin`, escribe la cookie y vuelve a la página con un `303`; en el adaptador `static` necesita JavaScript.'].join('\n'),
		attributes: [
			{ name: 'mode', syntax: 'mode="cycle" | mode="select"' },
			{ name: 'bind:themes', syntax: 'bind:themes="[\'light\', \'dark\']"' },
			{ name: 'bind:labels', syntax: 'bind:labels="{ light: \'Claro\', dark: \'Oscuro\', system: \'Sistema\' }"' },
			{ name: 'bind:messages', syntax: 'bind:messages="{ unknown: \'Cambiar tema\', group: \'Tema\' }"' },
			{ name: 'class', syntax: 'class="toggle"' },
		],
		examples: [['```html', '<!-- app/layouts/default.meeko -->', '<template>', '  <header>', '    <MeekoThemeToggle class="toggle">', '      <snippet name="light"><IconSun /></snippet>', '      <snippet name="dark"><IconMoon /></snippet>', '      <snippet name="system"><IconMonitor /></snippet>', '    </MeekoThemeToggle>', '  </header>', '  <main><MeekoOutlet /></main>', '</template>', '```'].join('\n')],
		see: ['docs/framework.md#meekothemetoggle', 'docs/framework.md#tema-clarooscuro-sin-parpadeo'],
		related: ['useTheme', 'ThemeToggleMessages', '<MeekoLink>'],
		source: { file: compiler, match: 'const themeToggleTag = "MeekoThemeToggle"' },
		aliases: ['<MeekoThemeToggle>', '<MeekoThemeToggle />', 'MeekoThemeToggle'],
	},
	{
		name: '<component is>',
		slug: 'component-tag',
		kind: 'tag',
		signatureLang: 'meeko',
		signature: ['<component is="props.content" bind:label="props.label"></component>', '<AppButton variant="primary" bind:label="title.value" on:save="save" />'].join('\n'),
		description: [
			'Renderiza un componente. `is` acepta una expresión que devuelve un módulo de componente, de tipo `Component<Props>`, y cada `bind:` define una prop tipada: CLI y VS Code comprueban las props requeridas, sus nombres y sus tipos. Si `is` cambia, Meeko libera la instancia anterior y renderiza e hidrata la nueva en los mismos marcadores. `<component>` requiere cierre explícito y no admite contenido (`MEEK031`).',
			'',
			'Desde `1.1`, una etiqueta cuyo nombre empieza por mayúscula es un componente: `<AppButton bind:label="\'Guardar\'" />` equivale a `<component is="AppButton" bind:label="\'Guardar\'"></component>`. El nombre es un import del script o un autoimport de `app/components`. Puede cerrarse sola y su contenido son snippets del hijo.',
			'',
			'Un atributo sin prefijo pasa una prop estática: su texto llega como un literal y un atributo sin valor, como `true`. `is`, `ref` y `html` no son props estáticas, ni los nombres con guiones (`MEEK032`); la misma prop estática y con `bind:` u `on:` da `MEEK090`. Una prop opcional acepta `undefined`, que equivale a no pasarla.',
		].join('\n'),
		attributes: [
			{ name: 'is', syntax: 'is="expresión"', description: 'El módulo del componente, `Component<Props>`; sólo en `<component>`.' },
			{ name: 'bind:', syntax: 'bind:prop="expresión"' },
			{ name: 'prop', syntax: 'prop="texto"', description: 'Prop estática: el texto como literal, o `true` sin valor.' },
			{ name: 'on:', syntax: 'on:evento="handler"', description: 'Prop de callback `onEvento` de un evento de `defineEmits`.' },
			{ name: 'model:', syntax: 'model:nombre="señal"' },
			{ name: 'ref:', syntax: 'ref:nombre' },
		],
		examples: [['```html', '<!-- Card.meeko -->', '<script lang="ts">', "import type { Component } from '@meekojs/meeko'", 'const props = defineProps<{ content: Component<{ label: string }>; label: string }>()', '</script>', '<template>', '  <section>', '    <component is="props.content" bind:label="props.label"></component>', '  </section>', '</template>', '```'].join('\n')],
		see: ['docs/api.md#etiquetas-de-componente-appbutton-', 'docs/api.md#props-estáticas', 'docs/api.md#componentes-meeko'],
		related: ['Component', 'ComponentModule', '<snippet>', '<MeekoOutlet />'],
		source: { file: compiler, match: 'if (node.tagName === "component" || componentTag) {' },
		aliases: ['<component is>', '<component is="...">', '<component>'],
	},
	{
		name: '<snippet>',
		slug: 'snippet-tag',
		kind: 'tag',
		since: '1.1.0',
		signatureLang: 'meeko',
		signature: '<snippet name="actions" params="close"><button on:click="close">Cerrar</button></snippet>',
		description: ['Llena un snippet con nombre de un componente hijo que lo declara con `defineSnippets`. El contenido suelto de la etiqueta del hijo llena `default`. El contenido usa el ámbito del padre, sus señales y funciones, y sigue siendo reactivo, también ante cambios de los argumentos.', '', 'Desde `1.4`, `if:when="expresión"` pasa el snippet sólo mientras la condición es verdadera: con ella falsa, para el hijo el snippet no existe (`snippets.x` es `undefined` y un `<render>` no pinta nada). Sirve para reenviar un snippet opcional. La condición se evalúa en el ámbito del padre, igual en SSR y al hidratar, y es reactiva sin volver a montar el hijo; estrecha los tipos dentro del contenido. Sólo vale si el hijo declara ese snippet opcional (`x?:`); en uno obligatorio es el error de tipos `MEEK110`.', '', '`MEEK061` señala un `<snippet>` que no es hijo directo de una etiqueta de componente, sin `name` o con un nombre o parámetros que no son identificadores, repetido, con atributos distintos de `name`, `params` e `if:when`, con un `if:when` vacío, o un `<snippet name="default">` junto a contenido suelto. Una `ref:` dentro de su contenido da `MEEK052`, porque el hijo puede pintarlo varias veces. Puede cerrarse solo.'].join('\n'),
		attributes: [
			{ name: 'name', syntax: 'name="actions"', description: 'Nombre del snippet que declara el hijo.' },
			{ name: 'params', syntax: 'params="a, b"', description: 'Nombres de sus parámetros, separados por comas, con los tipos de la tupla del hijo.' },
			{ name: 'if:when', syntax: 'if:when="snippets.actions"', description: 'Desde `1.4`. Pasa el snippet sólo mientras la expresión es verdadera; el hijo debe declararlo opcional.' },
		],
		examples: [['```html', '<AppDialog>', '  <p>{message.value}</p>', '  <snippet name="title">Confirmar</snippet>', '  <snippet name="actions" params="close"><button on:click="close">Cerrar</button></snippet>', '</AppDialog>', '```'].join('\n'), ['```html', '<!-- Reenvía actions sólo si este componente lo recibió -->', '<AppCard>', '  <render snippet="snippets.default" />', '  <snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet>', '</AppCard>', '```'].join('\n')],
		see: ['docs/api.md#snippets-con-definesnippets'],
		related: ['defineSnippets', '<render>', 'Snippet'],
		source: { file: compiler, match: 'function componentSnippets(' },
		aliases: ['<snippet>', '<snippet name="x" params="a, b">', '<snippet if:when>'],
	},
	{
		name: '<render>',
		slug: 'render-tag',
		kind: 'tag',
		since: '1.1.0',
		signatureLang: 'meeko',
		signature: '<render snippet="snippets.actions" args="close" />',
		description: ['Pinta, en el hijo, un snippet que le pasa el padre, con esos argumentos. Un `<render>` de un snippet opcional ausente no pinta nada; `if:when="snippets.title"` comprueba si el padre lo pasó. El snippet se pinta dentro del DOM del hijo, entre marcadores de comentario, pero pertenece al ámbito reactivo del padre.', '', '`MEEK062` señala un `<render>` sin `snippet`, con contenido o con atributos distintos de `snippet` y `args`. Puede cerrarse solo.'].join('\n'),
		attributes: [
			{ name: 'snippet', syntax: 'snippet="snippets.title"', description: 'Expresión con el snippet, normalmente una clave de `defineSnippets`.' },
			{ name: 'args', syntax: 'args="a, b"', description: 'Lista de expresiones con los argumentos del snippet.' },
		],
		examples: [['```html', '<!-- AppDialog.meeko -->', '<script lang="ts">', 'const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>();', 'const open = signal(true);', 'function close(): void {', '  open.value = false;', '}', '</script>', '<template>', '  <section if:when="open.value">', '    <h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>', '    <render snippet="snippets.default" />', '    <footer><render snippet="snippets.actions" args="close" /></footer>', '  </section>', '</template>', '```'].join('\n')],
		see: ['docs/api.md#snippets-con-definesnippets'],
		related: ['defineSnippets', '<snippet>', 'Snippet'],
		source: { file: compiler, match: 'function renderSnippetTag(' },
		aliases: ['<render>', '<render snippet="expresión" args="a, b" />'],
	},

	// Template directives and syntax.
	{
		name: '{expresión}',
		slug: 'interpolation',
		kind: 'directive',
		signatureLang: 'meeko',
		signature: '<p>{user.value.name} tiene {count.value} mensajes</p>',
		description: ['Texto con el valor de una expresión TypeScript, escapado. La expresión puede contener llaves propias de JavaScript: objetos literales (`{ { total: count.value }.total }`), plantillas literales con `${...}`, cadenas que incluyen `{` o `}`, comentarios y expresiones regulares. Termina en la llave que equilibra la de apertura; si no existe, el compilador informa `MEEK010`.', '', 'Para insertar HTML sin escapar use la directiva `html`.'].join('\n'),
		see: ['docs/api.md#componentes-meeko', 'docs/api.md#condiciones-con-ifwhen-y-tipos'],
		related: ['html', 'bind:nombre'],
		source: { file: compiler, match: 'function textParts(' },
		aliases: ['{expression}', '{expresión}'],
	},
	{
		name: 'if:when',
		slug: 'if-when',
		kind: 'directive',
		signatureLang: 'meeko',
		signature: '<p if:when="user.value">{user.value.name}</p>',
		description: ['La etiqueta, con su contenido, existe mientras la expresión es verdadera. Un nodo no puede tener `if:when` y `each:of` a la vez (`MEEK021`).', '', 'Desde `1.2`, `if:when` estrecha los tipos dentro de su elemento, como `v-if` en Vue: sus atributos, sus props, sus eventos y su contenido se comprueban sabiendo que la condición se cumple, en `meeko check` y en VS Code, sin `!`. TypeScript estrecha la misma referencia que comprueba la condición, también en las condiciones y listas anidadas y en los snippets de una etiqueta de componente. Dentro de una función flecha escrita en la plantilla no conserva el estrechamiento de una propiedad. Sólo cambia la comprobación: en ejecución el contenido nunca se evalúa con la condición falsa.'].join('\n'),
		examples: [['```html', '<p if:when="user.value">{user.value.name}</p>', '<WorkspaceHeader if:when="session.data.value.staff" bind:staff="session.data.value.staff" />', '```'].join('\n')],
		see: ['docs/api.md#condiciones-con-ifwhen-y-tipos'],
		related: ['each:of', '<render>'],
		source: { file: compiler, match: 'const condition = attrsList.find((attribute) => attribute.name === "if:when")' },
		aliases: ['if:when', 'if:when="expression"'],
	},
	{
		name: 'each:of',
		slug: 'each',
		kind: 'directive',
		signatureLang: 'meeko',
		signature: '<li each:of="todos.value" each:as="todo" each:key="todo.id" each:index="i">{i}. {todo.title}</li>',
		description: [
			'Repite la etiqueta por cada elemento de la lista. `each:as` nombra el elemento y `each:index` el índice, `index` por defecto, de tipo `number`. Las claves de `each:key` son cadenas o números finitos y únicas entre hermanos; `meeko check` comprueba que devuelve `string | number`. Una lista necesita identificadores válidos y distintos en `each:as` y `each:index` (`MEEK022`).',
			'',
			'Desde `1.1`, `each:key` es opcional. Sin clave, la clave de cada fila es su índice: la fila `i` conserva sus nodos y recibe el elemento `i`, y las filas sólo se añaden o se quitan al final. Use `each:key` cuando la lista cambia de orden o recibe elementos en medio y cada fila tiene estado propio: un componente hijo con señales, un control que el usuario está editando, el foco o una animación. Con la clave, Meeko mueve las filas existentes.',
		].join('\n'),
		attributes: [
			{ name: 'each:of', syntax: 'each:of="lista"' },
			{ name: 'each:as', syntax: 'each:as="elemento"' },
			{ name: 'each:key', syntax: 'each:key="elemento.id"' },
			{ name: 'each:index', syntax: 'each:index="i"' },
		],
		examples: [['```html', '<li each:of="tags.value" each:as="tag">{tag}</li>', '<li each:of="todos.value" each:as="todo" each:key="todo.id"><TodoItem bind:todo="todo" /></li>', '```'].join('\n')],
		see: ['docs/api.md#listas-con-y-sin-eachkey'],
		related: ['if:when', 'ref:nombre'],
		source: { file: compiler, match: 'const list = attrsList.find((attribute) => attribute.name === "each:of")' },
		aliases: ['each:of', 'each:key', 'each:as', 'each:index'],
	},
	{
		name: 'on:evento',
		slug: 'on',
		kind: 'directive',
		signatureLang: 'meeko',
		signature: '<input on:input="(event) => query.value = event.currentTarget.value" />',
		description: [
			'En un elemento HTML es un listener del DOM. Desde `1.2`, el evento tiene el tipo de `HTMLElementEventMap` para su nombre (`SVGElementEventMap` dentro de `<svg>`), como `KeyboardEvent` en `on:keydown`, y `Event` si el nombre no está en el mapa; `event.currentTarget` tiene el tipo del elemento de la etiqueta. `event.target` conserva el tipo `EventTarget | null`.',
			'',
			'Los handlers pueden ser asíncronos: Meeko observa su promesa y entrega los fallos al observador más cercano (`provideErrorHandler`), sin dejar un rechazo no manejado. La limpieza del componente elimina sus listeners.',
			'',
			'En una etiqueta de componente, `on:evento` es la prop de callback `onEvento` y recibe los argumentos de su `defineEmits`; el nombre es un identificador (`on:save-draft` da `MEEK011`) y escribir `on:save` junto a `bind:onSave` da `MEEK048`.',
		].join('\n'),
		examples: [['```html', '<button on:click="increment">{count.value}</button>', '<TodoItem bind:id="todo.id" on:save="save" on:close="() => open.value = false" />', '```'].join('\n')],
		see: ['docs/api.md#eventos-de-componente-defineemits-y-on', 'docs/api.md#componentes-meeko'],
		related: ['defineEmits', 'provideErrorHandler', 'ErrorSource'],
		source: { file: compiler, match: 'if (attr.name.startsWith("on:")) {' },
		aliases: ['on:', 'on:event', 'on:evento', 'on:event="handler"'],
	},
	{
		name: 'bind:nombre',
		slug: 'bind',
		kind: 'directive',
		signatureLang: 'meeko',
		signature: '<button bind:disabled="saving.value" bind:title="String(count.value)">Guardar</button>',
		description: ['Un atributo, o una prop en una etiqueta de componente, con el valor de una expresión. Los atributos booleanos se agregan o eliminan según el valor de la expresión.', '', 'En los controles de formulario, `bind:value` (en `input`, `textarea` y `select`), `bind:checked` (en `input`) y `bind:selected` (en `option`) actualizan también la propiedad del elemento, porque el navegador deja de leer el atributo en cuanto el usuario edita el control. Un `select multiple` no se sincroniza con `bind:value`; para un enlace en los dos sentidos use `model`.', '', '`bind:html` es un atributo HTML llamado `html` y, en un componente, `bind:ref` pasa una prop `ref`: ninguno es la directiva del mismo nombre.'].join('\n'),
		see: ['docs/api.md#componentes-meeko', 'docs/api.md#controles-de-formulario-con-model'],
		related: ['model', '<component is>'],
		source: { file: compiler, match: '} else if (attr.name.startsWith("bind:")) {' },
		aliases: ['bind:', 'bind:name="expression"'],
	},
	{
		name: 'model',
		slug: 'model',
		kind: 'directive',
		since: '1.1.0',
		signatureLang: 'meeko',
		signature: ['<input model="name">', '<AppInput model="name" model:open="settingsOpen" />'].join('\n'),
		description: [
			'Enlaza en los dos sentidos un control de formulario con una señal: el control muestra el valor de la señal y cada edición del usuario lo escribe en ella. La expresión debe ser una señal escribible del tipo del control; un `computed` o una señal de sólo lectura es un error de tipos y, en ejecución, un `TypeError`.',
			'',
			'| Control | Propiedad y evento | Tipo de la señal |',
			'| --- | --- | --- |',
			'| `<input>` de texto y `<textarea>` | `value`, en `input` | `string` |',
			'| `<input type="checkbox">` | `checked`, en `change` | `boolean` |',
			'| `<input type="radio">` | marcado si la señal vale su `value` | `string \\| null \\| undefined` |',
			'| `<select>` | `value`, en `change` | `string` |',
			'| `<select multiple>` | las opciones seleccionadas, en `change` | `string[]` |',
			'',
			'Un `<input type="number">` también entrega texto. Desde `1.2`, `model` admite `bind:type` y trata el control como uno de texto. `MEEK065` señala los usos no admitidos, como `model` fuera de `<input>`, `<textarea>` o `<select>`, o junto a `value`, `bind:value` u `on:input` en un control de texto.',
			'',
			'En una etiqueta de componente, `model` pasa la señal del modelo por defecto y `model:nombre` la de un modelo con nombre, que el hijo declara con `defineModel`. Un nombre que no es un identificador, el mismo modelo dos veces, un `model` sin valor o `model:x` junto a `bind:x` dan `MEEK066`. En un elemento personalizado (`<my-input model="query">`), `model` es un atributo HTML literal.',
		].join('\n'),
		attributes: [
			{ name: 'model', syntax: 'model="señal"' },
			{ name: 'model:', syntax: 'model:nombre="señal"' },
		],
		examples: [['```html', '<script lang="ts">', 'const name = signal("");', 'const accepted = signal(false);', 'const plan = signal<string | null>("free");', '</script>', '<template>', '  <input model="name">', '  <input type="checkbox" model="accepted">', '  <input type="radio" value="free" model="plan"> <input type="radio" value="pro" model="plan">', '</template>', '```'].join('\n')],
		see: ['docs/api.md#controles-de-formulario-con-model', 'docs/api.md#modelos-de-componente-definemodel-y-model'],
		related: ['defineModel', 'signal', 'Signal', 'bind:nombre'],
		source: { file: compiler, match: 'function nativeModel(' },
		aliases: ['model="signal"', 'model="señal"', 'model:nombre', 'model:name'],
	},
	{
		name: 'html',
		slug: 'html',
		kind: 'directive',
		since: '1.1.0',
		signatureLang: 'meeko',
		signature: '<article class="prose" html="article.value"></article>',
		description: '`html` y `model` son directivas sólo en los elementos HTML estándar. En un elemento personalizado (`<x-markdown html="intro">`) siguen siendo atributos HTML literales y el elemento admite hijos. Para reaccionar a clics dentro del HTML insertado, escuche en el propio elemento (`on:click`) y use `event.target.closest(...)`.',
		examples: [['```html', '<script lang="ts">', 'const article = signal("<p>Contenido <strong>generado</strong> en el servidor.</p>");', '</script>', '<template><article class="prose" html="article.value"></article></template>', '```'].join('\n')],
		see: ['docs/api.md#html-sin-escapar-con-html'],
		related: ['{expresión}', '<style scoped>'],
		source: { file: compiler, match: 'function htmlDirective(' },
		aliases: ['html="expression"', 'html="..."'],
	},
	{
		name: 'ref:nombre',
		slug: 'ref',
		kind: 'directive',
		signatureLang: 'meeko',
		signature: '<h2 ref:title>Buscar</h2>',
		description: ['Nombra, sin valor, un elemento o un componente de la plantilla, que el script lee con `useElementRef("nombre")`. En un elemento HTML o SVG su tipo sale de `HTMLElementTagNameMap` o `SVGElementTagNameMap`; en un componente, de su `defineExpose`. Dentro de `each:of`, una sola directiva nombra todas las filas.', '', 'Una `ref:` con valor, con un nombre que no es un identificador, en `<template>` o repetida en el mismo elemento da `MEEK052`; el mismo nombre en dos lugares de la plantilla da `MEEK053`. `ref="x"` y `bind:ref` no son directivas.'].join('\n'),
		examples: [['```html', '<script lang="ts">', 'const title = useElementRef("title");', 'const box = useElementRef("box");', 'onMounted(() => {', '  title.value?.scrollIntoView();', '});', '</script>', '<template>', '  <h2 ref:title>Buscar</h2>', '  <SearchBox ref:box />', '</template>', '```'].join('\n')],
		see: ['docs/api.md#referencias-a-elementos-ref-y-useelementref'],
		related: ['useElementRef', 'defineExpose'],
		source: { file: compiler, match: 'function isRefDirective(' },
		aliases: ['ref:', 'ref:name', 'ref:nombre'],
	},
]
