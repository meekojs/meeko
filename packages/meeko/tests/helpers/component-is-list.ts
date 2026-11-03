/**
 * An application whose page paints components chosen by data: an `each:` of `<component is>` with a
 * different module per row, its props in `bind`, an `on:` and a snippet. `meeko check`, the language
 * server and Chrome read the same files.
 */

/** Logs each mount and release in the browser, once per row instance. */
const lifecycle = (name: string): string => `onMounted(() => {
	const log = (window as unknown as { lifecycle: string[] }).lifecycle
	log.push("mount ${name}")
	return () => log.push("release ${name}")
})`

const appInput = `<script lang="ts">
const props = defineProps<{ placeholder: string; size?: number }>();
const emit = defineEmits<{ touched: [name: string] }>();
const snippets = defineSnippets<{ default?: [] }>();
const count = signal(0);
${lifecycle('input')}
</script>
<template><div class="input"><input bind:placeholder="props.placeholder" /><button type="button" class="count" on:click="() => { count.value++; emit('touched', 'input'); }">{count.value}</button><render snippet="snippets.default" /></div></template>
`

const appSelect = `<script lang="ts">
const props = defineProps<{ label: string; options: string[] }>();
const emit = defineEmits<{ touched: [name: string] }>();
const snippets = defineSnippets<{ default?: [] }>();
const count = signal(0);
${lifecycle('select')}
</script>
<template><div class="select"><label>{props.label}<select><option each:of="props.options" each:as="option" each:key="option">{option}</option></select></label><button type="button" class="count" on:click="() => { count.value++; emit('touched', 'select'); }">{count.value}</button><render snippet="snippets.default" /></div></template>
`

const page = `<script lang="ts">
import * as AppInput from "../components/AppInput.meeko";
import * as AppSelect from "../components/AppSelect.meeko";

// A module is no data: the state that travels to the browser names the entries, and a computed reads them.
const entries = {
	role: { component: AppSelect, props: { label: "Rol", options: ["admin", "user"] } },
	title: { component: AppSelect, props: { label: "Cargo", options: ["root"] } },
	name: { component: AppInput, props: { placeholder: "Nombre" } },
	other: { component: AppInput, props: { placeholder: "Otro" } },
};
type EntryName = "role" | "title" | "name" | "other";
const rows = signal<{ id: string; entry: EntryName }[]>([{ id: "role", entry: "role" }, { id: "name", entry: "name" }]);
const options = computed(() => rows.value.map((row) => ({ id: row.id, ...entries[row.entry] })));
const touched = signal<string[]>([]);
function point(id: string, entry: EntryName): void {
	rows.value = rows.value.map((row) => (row.id === id ? { id, entry } : row));
}
</script>
<template>
	<ul>
		<li each:of="options.value" each:as="option" each:key="option.id" bind:data-id="option.id">
			<component is="option.component" bind="option.props" on:touched="(name: string) => touched.value = [...touched.value, name]"><b class="slot">{option.id}</b></component>
		</li>
	</ul>
	<output id="touched">{touched.value.join(",")}</output>
	<button type="button" id="reverse" on:click="() => rows.value = [...rows.value].reverse()">invertir</button>
	<button type="button" id="add" on:click="() => rows.value = [...rows.value, { id: 'more', entry: 'other' }]">añadir</button>
	<button type="button" id="remove" on:click="() => rows.value = rows.value.filter((row) => row.id !== 'role')">quitar</button>
	<button type="button" id="swap" on:click="() => point('name', 'title')">cambiar</button>
	<button type="button" id="relabel" on:click="() => point('role', 'title')">renombrar</button>
	<MeekoLink id="about" to="/about">Acerca</MeekoLink>
</template>
`

/** The files of the application, from its root. */
export const componentIsListFiles: Readonly<Record<string, string>> = {
	'package.json': '{"name":"component-is-list-app","private":true,"type":"module"}\n',
	'meeko.config.mjs': 'export default {};\n',
	'app/components/AppInput.meeko': appInput,
	'app/components/AppSelect.meeko': appSelect,
	'app/pages/index.meeko': page,
	'app/pages/about.meeko': '<template><h1 id="about-title">Acerca</h1><MeekoLink id="home" to="/">Inicio</MeekoLink></template>\n',
}
