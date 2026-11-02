/** The polymorphic button of docs/api.md with one template, `'MeekoLink'` in `is`: shared by its type check and its e2e. */
export const polymorphicButton = `<script lang="ts">
import { computed } from '@meekojs/meeko'
import type { ElementAttributes } from '@meekojs/meeko'

type RouteParamsOf<K extends RouteId> = NonNullable<MeekoLinkProps<K>['params']>
type LinkTarget = {
	[K in RouteId]: { to: K; search?: MeekoLinkProps['search'] } & (keyof RouteParamsOf<K> extends never ? { params?: never } : { params: RouteParamsOf<K> })
}[RouteId]
type LinkProps = LinkTarget & { href?: never; target?: never; rel?: never; download?: never; type?: never; disabled?: never }
type AnchorProps = { href: string; target?: '_self' | '_blank' | '_parent' | '_top'; rel?: string; download?: string | boolean; to?: never; params?: never; search?: never; type?: never; disabled?: never }
type ButtonProps = { type?: 'button' | 'submit' | 'reset'; disabled?: boolean; to?: never; params?: never; search?: never; href?: never; target?: never; rel?: never; download?: never }
type SharedAttributes = Pick<ElementAttributes<'a'>, keyof ElementAttributes<'a'> & keyof ElementAttributes<'button'>>
type ForwardedAttributes = Omit<SharedAttributes, 'class' | 'type'>

const props = defineProps<(LinkProps | AnchorProps | ButtonProps) & ForwardedAttributes & { label?: string; class?: string }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const snippets = defineSnippets<{ default?: [] }>()

const linkRel = computed(() => props.rel ?? (props.target === '_blank' ? 'noopener noreferrer' : undefined))
const attributes = computed((): ForwardedAttributes => {
	const { to, params, search, href, target, rel, download, type, disabled, label, class: className, ...rest } = props
	return rest
})
</script>
<template>
	<component
		is="props.to !== undefined ? 'MeekoLink' : props.href !== undefined ? 'a' : 'button'"
		bind:to="props.to"
		bind:params="props.params"
		bind:search="props.search"
		bind:class="props.class"
		bind="attributes.value"
		bind:href="props.href"
		bind:target="props.target"
		bind:rel="linkRel.value"
		bind:download="props.download"
		bind:type="props.type ?? 'button'"
		bind:disabled="props.disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</component>
</template>
`
