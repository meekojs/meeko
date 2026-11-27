import { builtinComponentModules } from '../compiler'
/**
 * Meeko's own template tags (`<MeekoLink>`, `<MeekoOutlet />`…) as the editor sees them: their props,
 * their content, their documentation and where they are valid. One entry per tag; the virtual code,
 * the hover, "go to definition" and the completion read this table, so a new built-in tag only adds
 * an entry here, its props type in `@meekojs/meeko/framework` and that type's name in
 * `builtinTagTypes` of `autoimports/registry.ts`, which autoimports it.
 */
import { readThemeEnabledSync } from '../framework/config'
import { t } from './l10n'

/** A prop of a built-in tag, as the template writes it. */
export interface BuiltinTagProp {
	/** Name of the prop in the props type, such as `params`. */
	readonly name: string
	/** Attributes that set it, the preferred one first: `bind:params`; `to` also admits `bind:to`. */
	readonly attributes: readonly string[]
	/** Type shown when the package does not declare {@link BuiltinTag.propsType}. */
	readonly type: string
	readonly optional: boolean
	/** Markdown, used when the package does not declare the props type. */
	readonly documentation: string
	/** Completion snippet of the attribute, such as `bind:params="{ $1 }"`. */
	readonly insert: string
	/** Short text of the completion item. */
	readonly detail: string
	/** After inserting it, ask for completion again (the routes of `to="…"`). */
	readonly suggest?: boolean
}

/** A snippet a built-in tag renders: `default` is its content. */
export interface BuiltinTagSnippet {
	readonly name: string
	readonly parameters: string
	readonly optional: boolean
	readonly documentation: string
}

/** A tag of Meeko's own that the compiler turns into an element or a component. */
export interface BuiltinTag {
	readonly name: string
	/**
	 * Interface of `@meekojs/meeko/framework` that declares the props. The hover reads its members
	 * and their JSDoc, and "go to definition" opens it. An older package without it falls back to
	 * {@link props}.
	 */
	readonly propsType: string
	/**
	 * Type parameters of {@link propsType} and of the check of each tag, from its static attributes:
	 * `<MeekoLink to="/users/[id]">` checks `MeekoLinkProps<"/users/[id]">`.
	 */
	readonly typeArguments?: (attributes: ReadonlyMap<string, string>) => string | undefined
	/**
	 * Generic parameters of the virtual check `declare function __meeko_builtin_X<…>(props: …)`,
	 * whose argument then infers them from the tag's props; `props` is its parameter type.
	 */
	readonly check?: { readonly parameters: string; readonly props: string; readonly declarations?: string }
	readonly props: readonly BuiltinTagProp[]
	readonly snippets: readonly BuiltinTagSnippet[]
	/**
	 * HTML element it renders: every other attribute, its `on:` events (typed as that element's) and
	 * its content go to it. Without one the tag admits no other attributes.
	 */
	readonly element?: string
	/** Attributes the tag rejects, such as `href` on `<MeekoLink>`; the completion leaves them out. */
	readonly rejected?: readonly string[]
	/** One paragraph of Markdown for the hover. */
	readonly summary: string
	/** Guide of the tag. */
	readonly guide: string
	/** Detail of the `<` completion item. */
	readonly completion: string
	/** Components where the tag is valid; any component if omitted. */
	readonly allowedIn?: (filename: string) => boolean
	/**
	 * Whether the project has the tag, from its root (`<MeekoThemeToggle>` needs `theme` in
	 * `meeko.config.ts`); always if omitted. The `<` completion leaves it out otherwise.
	 */
	readonly enabled?: (projectRoot: string) => boolean
	/**
	 * The tag is a component that Meeko compiles and ships (`<MeekoThemeToggle>`): the virtual code
	 * checks it as a component tag, so its props, snippets and directives are typed like any other;
	 * the table gives its completion, hover and definition.
	 */
	readonly component?: boolean
	/**
	 * Module of a {@link component} tag that ships on its own (`@meekojs/meeko/builtins/popover`):
	 * the virtual code declares the tag as that module, which the compiled component imports only
	 * when it uses the tag. Every component tag has one; the compiler reads the same specifiers from
	 * `builtinComponentModules`.
	 */
	readonly module?: string
	/**
	 * Type of `@meekojs/meeko/framework` whose keys are the tag's snippets when they depend on the
	 * application (one per theme of `meeko.config.ts`). The hover lists them; without its keys (no
	 * generated declarations, an older package) it shows {@link snippets}.
	 */
	readonly snippetsType?: string
}

const guide = 'https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekooutlet--y-meekolink'
const themeGuide = 'https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekothemetoggle'
const popoverGuide = 'https://github.com/meekojs/meeko/blob/main/docs/api.md#popover-meekopopover'
const selectGuide = 'https://github.com/meekojs/meeko/blob/main/docs/api.md#select-meekoselect'

/** The placements of `<MeekoPopover>` and `<MeekoSelect>`, for the completion of `placement`. */
const placements = 'top,top-start,top-end,bottom,bottom-start,bottom-end,left,left-start,left-end,right,right-start,right-end'

/** A prop of the table, for the props that `<MeekoPopover>` and `<MeekoSelect>` share. */
function prop(name: string, type: string, documentation: () => string, detail: string | (() => string), options: { attributes?: readonly string[]; insert?: string; optional?: boolean } = {}): BuiltinTagProp {
	return {
		name,
		type,
		get documentation() {
			return documentation()
		},
		get detail() {
			return typeof detail === 'function' ? detail() : detail
		},
		attributes: options.attributes ?? [`bind:${name}`],
		optional: options.optional ?? true,
		insert: options.insert ?? `${options.attributes?.[0] ?? `bind:${name}`}="$1"`,
	}
}
const framework = 'import("@meekojs/meeko/framework")'

/** `app/app.meeko`, a layout of `app/layouts` or a `+layout.meeko`: where `<MeekoOutlet />` is valid. */
export function isOutletHost(filename: string): boolean {
	return /[\\/]app[\\/]app\.meeko$|[\\/]app[\\/]layouts[\\/].+\.meeko$|[\\/]\+layout\.meeko$/.test(filename)
}

/** Meeko's own tags, in the order the completion offers them. */
export const builtinTags: readonly BuiltinTag[] = [
	{
		name: 'MeekoLink',
		propsType: 'MeekoLinkProps',
		typeArguments: (attributes) => {
			const to = attributes.get('to')
			return to === undefined ? undefined : `<${JSON.stringify(to)}>`
		},
		// The same rule as `meeko check` (`__MeekoLinkOptions` in compiler.ts) without hardening
		// `MeekoLinkProps.params`, which stays optional for `NonNullable<MeekoLinkProps<K>["params"]>`:
		// with generated routes a dynamic route requires its params and a static one forbids them; a union of
		// routes or no generated routes leave them optional.
		check: {
			parameters: `<K extends ${framework}.MeekoLinkProps["to"]>`,
			props: `${framework}.MeekoLinkProps<K> & __MeekoLinkCheckParams<K>`,
			declarations: [
				`type __MeekoLinkCheckRoutes = ${framework}.GeneratedRoutes;`,
				'type __MeekoLinkCheckValues<K extends string> = K extends keyof __MeekoLinkCheckRoutes ? __MeekoLinkCheckRoutes[K] : Record<string, string>;',
				'type __MeekoLinkCheckUnion<K extends string, A extends string = K> = K extends unknown ? ([A] extends [K] ? false : true) : never;',
				'type __MeekoLinkCheckParams<K extends string> = keyof __MeekoLinkCheckRoutes extends never ? unknown',
				'  : true extends __MeekoLinkCheckUnion<K> ? unknown',
				'  : keyof __MeekoLinkCheckValues<K> extends never ? { params?: undefined } : { params: __MeekoLinkCheckValues<K> };',
				'',
			].join('\n'),
		},
		props: [
			{
				name: 'to',
				attributes: ['to', 'bind:to'],
				type: 'string',
				optional: false,
				get documentation() {
					return t('Route ID of the target, like `to="/users/[id]"`: only routes that exist.')
				},
				insert: 'to="$1"',
				get detail() {
					return t('Page route, like /users/[id]: only existing ones')
				},
				suggest: true,
			},
			{
				name: 'params',
				attributes: ['bind:params'],
				type: 'Record<string, string>',
				optional: true,
				get documentation() {
					return t('Parameters of a dynamic route, like `bind:params="{ id: user.id }"`; required on dynamic routes.')
				},
				insert: 'bind:params="{ $1 }"',
				get detail() {
					return t('Parameters of a dynamic route, like { id: user.id }')
				},
			},
			{
				name: 'search',
				attributes: ['bind:search'],
				type: 'Readonly<Record<string, string | number | boolean | null | undefined>>',
				optional: true,
				get documentation() {
					return t('Query string, like `bind:search="{ tab: \'profile\' }"`. Omits `null` and `undefined`.')
				},
				insert: 'bind:search="{ $1 }"',
				get detail() {
					return t('Query string, like { tab: "profile" }')
				},
			},
			{
				name: 'match',
				attributes: ['match', 'bind:match'],
				type: '"exact" | "prefix"',
				optional: true,
				get documentation() {
					return t('`"exact"` (default), active only on its own route, with `aria-current="page"`; `"prefix"`, also on the routes below it (`/dashboard` covers `/dashboard/stats`), with `aria-current="true"`. `to="/"` only matches exactly.')
				},
				insert: 'match="${1|exact,prefix|}"',
				get detail() {
					return t('"exact" (default), only its own route, or "prefix", also the routes below it')
				},
			},
			{
				name: 'resolve',
				attributes: ['bind:resolve'],
				type: 'boolean',
				optional: true,
				get documentation() {
					return t('Whether the `href` goes through the application link resolvers (`app.resolveLink`, like the language prefix of `@meekojs/i18n`). `true` by default; `bind:resolve="false"` leaves the `href` of `href()`.')
				},
				insert: 'bind:resolve="false"',
				get detail() {
					return t('false: the href without link resolvers, like the language prefix')
				},
			},
		],
		snippets: [
			{
				name: 'default',
				parameters: '',
				optional: true,
				get documentation() {
					return t('The content of the link, inside the `<a>`.')
				},
			},
		],
		element: 'a',
		rejected: ['href', 'bind:href', 'params', 'search', 'resolve'],
		get summary() {
			return t('Link to a page of the application: it renders an `<a>` whose `href` is built by `href()` from `to`, `bind:params` and `bind:search`, and adds `aria-current="page"` on the active route; with `match="prefix"`, also `aria-current="true"` on the routes below it. The `href` goes through the application link resolvers (like the language prefix of `@meekojs/i18n`), except with `bind:resolve="false"`. The remaining attributes (`class`, `target`, `hreflang`, `aria-*`, `on:click`…) and the content go to the `<a>`.')
		},
		guide,
		get completion() {
			return t('Link to a typed route: <MeekoLink to="/users/[id]" bind:params="{ id }">')
		},
	},
	{
		name: 'MeekoOutlet',
		propsType: 'MeekoOutletProps',
		props: [],
		snippets: [],
		get summary() {
			return t('Renders the layout or page that goes inside, from the `outlet` prop that Meeko passes. Only in `app/app.meeko` and in layouts, with no attributes or content (`MEEK104`).')
		},
		guide,
		get completion() {
			return t('The page or layout inside: <MeekoOutlet />')
		},
		allowedIn: isOutletHost,
	},
	{
		name: 'MeekoThemeToggle',
		propsType: 'MeekoThemeToggleProps',
		props: [
			{
				name: 'mode',
				attributes: ['mode', 'bind:mode'],
				type: '"cycle" | "select"',
				optional: true,
				get documentation() {
					return t('`"cycle"` (default), a button that moves to the next choice; `"select"`, a radio group.')
				},
				insert: 'mode="${1|cycle,select|}"',
				get detail() {
					return t('"cycle" (default), a button that moves to the next theme, or "select", a radio group')
				},
			},
			{
				name: 'themes',
				attributes: ['bind:themes'],
				type: 'readonly string[]',
				optional: true,
				get documentation() {
					return t('Choices and their order, like `bind:themes="[\'light\', \'dark\']"`; by default, the themes of the configuration and `"system"` if enabled.')
				},
				insert: 'bind:themes="[$1]"',
				get detail() {
					return t("Choices and their order, like ['light', 'dark']")
				},
			},
			{
				name: 'labels',
				attributes: ['bind:labels'],
				type: 'Partial<Record<string, string>>',
				optional: true,
				get documentation() {
					return t('Name of each choice, like `bind:labels="{ dark: \'Oscuro\' }"`; by default, "Claro", "Oscuro", "Sistema" and the name of the other themes.')
				},
				insert: 'bind:labels="{ $1 }"',
				get detail() {
					return t("Name of each choice, like { dark: 'Oscuro' }")
				},
			},
			{
				name: 'messages',
				attributes: ['bind:messages'],
				type: 'ThemeToggleMessages',
				optional: true,
				get documentation() {
					return t('Accessible texts of the button and the group (`cycle(current, next)`, `unknown` and `group`), so you can translate them.')
				},
				insert: 'bind:messages="{ $1 }"',
				get detail() {
					return t('Accessible texts: cycle(current, next), unknown and group')
				},
			},
			{
				name: 'class',
				attributes: ['class', 'bind:class'],
				type: 'string',
				optional: true,
				get documentation() {
					return t('Classes of the root element, the `<form>`.')
				},
				insert: 'class="$1"',
				get detail() {
					return t('Classes of the root <form>')
				},
			},
			{
				name: 'id',
				attributes: ['id', 'bind:id'],
				type: 'string',
				optional: true,
				get documentation() {
					return t('`id` of the root element, the `<form>`.')
				},
				insert: 'id="$1"',
				get detail() {
					return t('id of the root <form>')
				},
			},
		],
		// Without the generated declarations of the themes: the choices of `theme: true`.
		snippets: ['light', 'dark', 'system'].map((name) => ({
			name,
			parameters: '',
			optional: true,
			get documentation() {
				return t('Icon of the choice `{0}`; without it, its name is rendered.', name)
			},
		})),
		snippetsType: 'ThemeToggleSnippets',
		component: true,
		module: builtinComponentModules.MeekoThemeToggle!.specifier,
		get summary() {
			return t('Light/dark theme selector for `theme` in `meeko.config.ts`, a component that Meeko compiles and ships: a `<form method="post" action="/_meeko/theme">` that works without JavaScript. It renders an icon per choice, the snippet with its name, and the rule that Meeko adds to `<head>` shows the one of `data-theme-choice` on `<html>`, so it never jumps. `mode="cycle"` is a button that moves to the next theme and `mode="select"`, a radio group. Without `theme` it is the error `MEEK111`.')
		},
		guide: themeGuide,
		get completion() {
			return t('Switches the light/dark theme without flicker: <MeekoThemeToggle mode="cycle">')
		},
		enabled: (projectRoot) => readThemeEnabledSync(projectRoot) !== false,
	},
	{
		name: 'MeekoAwait',
		propsType: 'MeekoAwaitProps',
		props: [
			{
				name: 'for',
				attributes: ['for', 'bind:for'],
				type: 'AwaitResource | readonly AwaitResource[]',
				optional: false,
				get documentation() {
					return t('Resource to wait for, as an expression: the result of `useApi` or `useRpcQuery` without `await` (`for="items"`) or a list (`for="[items, stats]"`). Inside the content, `items.data.value` is no longer `null`.')
				},
				insert: 'for="$1"',
				get detail() {
					return t('Resource from useApi or useRpcQuery without await, or a list: for="items"')
				},
			},
			{
				name: 'reserve',
				attributes: ['reserve', 'bind:reserve'],
				type: 'boolean | string',
				optional: true,
				get documentation() {
					return t('While waiting, the zone takes the height it had with data last time (per route, request and instance, in `sessionStorage`). `reserve="320px"` also sets a minimum, even on the first visit.')
				},
				insert: 'reserve',
				get detail() {
					return t('Reserves the height it had with data; reserve="320px" adds a minimum')
				},
			},
			{
				name: 'messages',
				attributes: ['bind:messages'],
				type: 'AwaitMessages',
				optional: true,
				get documentation() {
					return t('Texts of the default error notice (`error` and `retry`), without the `error` snippet, so you can translate them.')
				},
				insert: 'bind:messages="{ $1 }"',
				get detail() {
					return t('Texts of the default error notice: error and retry')
				},
			},
			{
				name: 'class',
				attributes: ['class', 'bind:class'],
				type: 'string',
				optional: true,
				get documentation() {
					return t('Classes of the container, a `<div>`.')
				},
				insert: 'class="$1"',
				get detail() {
					return t('Classes of the container <div>')
				},
			},
			{
				name: 'id',
				attributes: ['id', 'bind:id'],
				type: 'string',
				optional: true,
				get documentation() {
					return t('`id` of the container.')
				},
				insert: 'id="$1"',
				get detail() {
					return t('id of the container <div>')
				},
			},
		],
		snippets: [
			{
				name: 'default',
				parameters: 'refreshing: boolean',
				optional: false,
				get documentation() {
					return t('The content with data; `refreshing` is `true` during a reload, which keeps it.')
				},
			},
			{
				name: 'pending',
				parameters: '',
				optional: true,
				get documentation() {
					return t('The first load: a skeleton with the height of the content.')
				},
			},
			{
				name: 'error',
				parameters: 'error: Error, retry: () => void',
				optional: true,
				get documentation() {
					return t('A failure with no data: `error` and `retry`, which requests it again. Without it, a notice with `role="alert"` and a button.')
				},
			},
		],
		component: true,
		module: builtinComponentModules.MeekoAwait!.specifier,
		get summary() {
			return t('Zone of data that arrives after the first paint (`useApi` or `useRpcQuery` without `await`), a component that Meeko compiles and ships: it renders `pending` on the first load, `error` (with `retry`) if it fails and its content when there is data, which it keeps during reloads. With `reserve`, while waiting it takes the height it had with data, so the card does not jump. It sets `aria-busy` while loading.')
		},
		guide: 'https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekoawait',
		get completion() {
			return t('Data that arrives after the first paint, without jumps: <MeekoAwait for="items" reserve>')
		},
	},
	{
		name: 'MeekoTeleport',
		propsType: 'MeekoTeleportProps',
		props: [
			{
				name: 'to',
				attributes: ['to', 'bind:to'],
				type: 'MeekoTeleportTarget',
				optional: false,
				get documentation() {
					return t('Target: `"body"`, at the end of `<body>`, or `"#id"`, inside the element with that `id`, after what it already has.')
				},
				insert: 'to="$1"',
				get detail() {
					return t('Target: "body" or the "#id" of an element in the document')
				},
				suggest: true,
			},
			{
				name: 'disabled',
				attributes: ['disabled', 'bind:disabled'],
				type: 'boolean',
				optional: true,
				get documentation() {
					return t('With `true`, the content renders in place, without moving; changing it moves the same nodes.')
				},
				insert: 'disabled',
				get detail() {
					return t('Renders the content in place, without moving it')
				},
			},
		],
		snippets: [
			{
				name: 'default',
				parameters: '',
				optional: true,
				get documentation() {
					return t('The content that renders at the target.')
				},
			},
		],
		get summary() {
			return t('Renders its content elsewhere in the document (`to="body"` or `to="#id"`) without taking it out of the component, which keeps its reactive scope, events, snippets, `provide`/`inject`, error handlers and `scoped` CSS. The server HTML already carries it at its target. With `disabled` it renders in place. An attribute it does not admit is the error `MEEK114`.')
		},
		guide: 'https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekoteleport',
		get completion() {
			return t('Content elsewhere in the document: <MeekoTeleport to="#toolbar">')
		},
	},
	{
		name: 'MeekoPopover',
		propsType: 'MeekoPopoverProps',
		props: [
			prop(
				'mode',
				'"auto" | "manual" | "hint"',
				() => t('`"auto"` (default) closes when clicking outside; `"manual"`, only from the trigger, `Esc` or the model; `"hint"` is a tooltip that opens with the pointer or focus.'),
				() => t('"auto", "manual" or "hint" (tooltip)'),
				{ attributes: ['mode', 'bind:mode'], insert: 'mode="${1|auto,manual,hint|}"' },
			),
			prop(
				'placement',
				'PopoverPlacement',
				() => t('Where it opens relative to the trigger: `top`, `bottom`, `left` or `right`, with `-start` or `-end`; `"bottom-start"` by default.'),
				() => t('Side and alignment, like bottom-start'),
				{ attributes: ['placement', 'bind:placement'], insert: `placement="\${1|${placements}|}"` },
			),
			prop(
				'offset',
				'number',
				() => t('Distance in pixels between the trigger and the content.'),
				() => t('Distance in pixels'),
				{ insert: 'bind:offset="${1:8}"' },
			),
			prop(
				'role',
				'"menu" | "dialog" | "tooltip"',
				() => t('ARIA pattern of the content: a menu with arrows and type-ahead, a dialog or a tooltip.'),
				() => t('menu, dialog or tooltip'),
				{ attributes: ['role', 'bind:role'], insert: 'role="${1|menu,dialog,tooltip|}"' },
			),
			prop(
				'label',
				'string',
				() => t('`aria-label` of the content; without it, a menu or dialog is named by the trigger.'),
				() => t('aria-label of the content'),
				{ attributes: ['label', 'bind:label'] },
			),
			prop(
				'class',
				'string',
				() => t('Classes of the content, the element with `popover`.'),
				() => t('Classes of the content'),
				{ attributes: ['class', 'bind:class'] },
			),
			prop(
				'triggerClass',
				'string',
				() => t('Classes of the trigger `<button>`.'),
				() => t('Classes of the trigger button'),
				{ attributes: ['triggerClass', 'bind:triggerClass'] },
			),
			prop(
				'triggerId',
				'string',
				() => t('`id` of the trigger; with a custom trigger, the `id` it carries.'),
				() => t('id of the trigger'),
				{ attributes: ['triggerId', 'bind:triggerId'] },
			),
			prop(
				'matchWidth',
				'boolean',
				() => t('The content is at least as wide as the trigger.'),
				() => t('Minimum width of the trigger'),
				{ attributes: ['matchWidth', 'bind:matchWidth'], insert: 'matchWidth' },
			),
			prop(
				'delay',
				'number',
				() => t('With `mode="hint"`, milliseconds before opening with the pointer (300).'),
				() => t('Tooltip delay in ms'),
			),
			prop(
				'closeDelay',
				'number',
				() => t('With `mode="hint"`, milliseconds before closing when the pointer leaves (150).'),
				() => t('Tooltip close delay in ms'),
			),
		],
		snippets: [
			{
				name: 'default',
				parameters: '',
				optional: true,
				get documentation() {
					return t('The content of the popover.')
				},
			},
			{
				name: 'trigger',
				parameters: '',
				optional: true,
				get documentation() {
					return t('The content of the trigger `<button>` that Meeko renders.')
				},
			},
			{
				name: 'anchor',
				parameters: 'trigger: PopoverTrigger',
				optional: true,
				get documentation() {
					return t('A custom trigger instead of the button; apply the attributes of `trigger` (`id`, `aria-expanded`…).')
				},
			},
		],
		component: true,
		module: builtinComponentModules.MeekoPopover!.specifier,
		get summary() {
			return t('Popover anchored with the native `popover` API and *CSS anchor positioning* (with a JavaScript calculation where it does not exist): the content is in the top layer, hidden from the server HTML. It renders a `<button>` with `popovertarget`, `aria-expanded`, `aria-controls` and `aria-haspopup`; `model` is the open signal and `on:toggle` emits `{ open }`. `Esc` closes and returns focus; with `role="menu"`, arrows, `Home`/`End` and type-ahead search.')
		},
		guide: popoverGuide,
		get completion() {
			return t('Anchored popover (menu, dialog or tooltip): <MeekoPopover placement="bottom-start">')
		},
	},
	{
		name: 'MeekoSelect',
		propsType: 'MeekoSelectProps',
		// The hover of a tag that does not know the type of its options.
		typeArguments: () => '<unknown>',
		props: [
			prop(
				'options',
				'readonly T[]',
				() => t('The options, primitives or objects; their type gives that of the model and of the snippets.'),
				() => t('Options, like colors or users.value'),
				{ optional: false, insert: 'bind:options="$1"' },
			),
			prop(
				'multiple',
				'boolean',
				() => t('The model is an array and each option is toggled.'),
				() => t('Choose several options'),
				{ attributes: ['multiple', 'bind:multiple'], insert: 'multiple' },
			),
			prop(
				'by',
				'keyof T | ((a: T, b: T) => boolean)',
				() => t('How options are compared with the value: a key (`by="id"`) or a function.'),
				() => t('Key or comparison function'),
				{ attributes: ['by', 'bind:by'] },
			),
			prop(
				'labelBy',
				'keyof T | ((option: T) => string)',
				() => t('Label of each option; by default, the text of the primitive or `label`/`name`.'),
				() => t('Key or label function'),
				{ attributes: ['labelBy', 'bind:labelBy'] },
			),
			prop(
				'disabledBy',
				'keyof T | ((option: T) => boolean)',
				() => t('Which options are disabled; by default, those with `disabled: true`.'),
				() => t('Key or disabled function'),
				{ attributes: ['disabledBy', 'bind:disabledBy'] },
			),
			prop(
				'groupBy',
				'keyof T | ((option: T) => string | undefined)',
				() => t('Group of each option, with a heading per group.'),
				() => t('Key or group function'),
				{ attributes: ['groupBy', 'bind:groupBy'] },
			),
			prop(
				'placeholder',
				'string',
				() => t('Text of the trigger when no value is chosen.'),
				() => t('Text without a value'),
				{ attributes: ['placeholder', 'bind:placeholder'] },
			),
			prop(
				'name',
				'string',
				() => t('`name` of the `<input type="hidden">` elements sent with the `<form>`.'),
				() => t('name in the form'),
				{ attributes: ['name', 'bind:name'] },
			),
			prop(
				'required',
				'boolean',
				() => t('Requires a value when submitting the `<form>`.'),
				() => t('Required value'),
				{ attributes: ['required', 'bind:required'], insert: 'required' },
			),
			prop(
				'disabled',
				'boolean',
				() => t('Disables the trigger; the values are not sent.'),
				() => t('Disabled'),
				{ attributes: ['disabled', 'bind:disabled'], insert: 'disabled' },
			),
			prop(
				'searchable',
				'boolean',
				() => t('The trigger is a combobox with an `<input>` that filters the options.'),
				() => t('Searchable'),
				{ attributes: ['searchable', 'bind:searchable'], insert: 'searchable' },
			),
			prop(
				'filter',
				'SelectFilter<T>',
				() => t('Custom search, synchronous or asynchronous (`(query, { options, signal }) => …`).'),
				() => t('Custom search, also async'),
			),
			prop(
				'max',
				'number',
				() => t('With `multiple`, how many options can be chosen at most.'),
				() => t('Maximum chosen options'),
			),
			prop(
				'field',
				'SelectField<…>',
				() => t("The `useForm` field, `form.field('x')`: `id`, `name`, value, `aria-invalid` and `aria-describedby`."),
				() => t('useForm field'),
				{ insert: 'bind:field="form.field(\'$1\')"' },
			),
			prop(
				'id',
				'string',
				() => t('`id` of the trigger, for a `<label for>`.'),
				() => t('id of the trigger'),
				{ attributes: ['id', 'bind:id'] },
			),
			prop('label', 'string', () => t('`aria-label` of the trigger and the list, without `<label>`.'), 'aria-label', { attributes: ['label', 'bind:label'] }),
			prop('describedBy', 'string', () => t('`aria-describedby` of the trigger.'), 'aria-describedby', { attributes: ['describedBy', 'bind:describedBy'] }),
			prop('invalid', 'boolean', () => t('Marks the trigger with `aria-invalid="true"`.'), 'aria-invalid'),
			prop(
				'class',
				'string',
				() => t('Classes of the root element.'),
				() => t('Classes of the root'),
				{ attributes: ['class', 'bind:class'] },
			),
			prop(
				'listClass',
				'string',
				() => t('Classes of the list, the element with `popover`.'),
				() => t('Classes of the list'),
				{ attributes: ['listClass', 'bind:listClass'] },
			),
			prop(
				'placement',
				'PopoverPlacement',
				() => t('Where the list opens; `"bottom-start"` by default.'),
				() => t('Side and alignment of the list'),
				{ attributes: ['placement', 'bind:placement'], insert: `placement="\${1|${placements}|}"` },
			),
			prop(
				'offset',
				'number',
				() => t('Distance in pixels between the trigger and the list.'),
				() => t('Distance in pixels'),
			),
		],
		snippets: [
			{
				name: 'option',
				parameters: 'option: T, state: SelectOptionState',
				optional: true,
				get documentation() {
					return t('Content of each option; `state` says whether it is chosen, active or disabled.')
				},
			},
			{
				name: 'value',
				parameters: 'option: T',
				optional: true,
				get documentation() {
					return t('How each chosen value is shown in the trigger.')
				},
			},
			{
				name: 'group',
				parameters: 'name: string',
				optional: true,
				get documentation() {
					return t('Heading of a `groupBy` group.')
				},
			},
			{
				name: 'empty',
				parameters: '',
				optional: true,
				get documentation() {
					return t('What is shown when there are no options; by default, "Sin resultados".')
				},
			},
			{
				name: 'loading',
				parameters: '',
				optional: true,
				get documentation() {
					return t('What is shown while an asynchronous search loads.')
				},
			},
		],
		component: true,
		module: builtinComponentModules.MeekoSelect!.specifier,
		get summary() {
			return t('Accessible select on `<MeekoPopover>`: a `role="combobox"` with `aria-activedescendant` (focus stays on the trigger or the `<input>` of `searchable`) and a `role="listbox"`. `model` is the value (an array with `multiple`), typed by `options`; `by` compares objects, `groupBy` groups, `max` limits and `name` sends `<input type="hidden">`. No visual styles: `data-active`, `data-selected` and `data-disabled` on the options and `data-open` on the root.')
		},
		guide: selectGuide,
		get completion() {
			return t('Accessible select with search and multiple: <MeekoSelect model="value" bind:options="options">')
		},
	},
]

const byName = new Map(builtinTags.map((tag) => [tag.name, tag]))

/** The built-in tag with this name, if there is one. */
export function builtinTag(name: string): BuiltinTag | undefined {
	return byName.get(name)
}

/** The prop of a built-in tag that an attribute sets (`bind:params` → `params`), if any. */
export function builtinTagProp(tag: BuiltinTag, attribute: string): BuiltinTagProp | undefined {
	return tag.props.find((prop) => prop.attributes.includes(attribute))
}
