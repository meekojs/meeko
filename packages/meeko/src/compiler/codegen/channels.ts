import type { GenericParameters } from '../generic'

import { modelEventName, modelPropName } from '../../shared/model-names'
import { markSource } from '../mapping'

interface ChannelSource {
	exposed: boolean
	models: readonly { name: string; type: string; typeOffset: number; optional: boolean }[]
	snippets?: { type: string; offset: number }
}

/** A `defineModel` of a component, as the types of its module need it. */
interface ModelTypeSource {
	readonly name: string
	readonly optional: boolean
}

/** Object types of the props and of the events of some models, from the type text of each value. */
export function modelMemberTypes(models: readonly ModelTypeSource[], value: (name: string) => string): { values: string; emits: string } {
	return {
		values: `{ ${models.map((model) => `${modelPropName(model.name)}?: ${value(model.name)} | undefined`).join('; ')} }`,
		emits: `{ ${models.map((model) => `${JSON.stringify(modelEventName(model.name))}: [next: ${value(model.name)}]`).join('; ')} }`,
	}
}

/**
 * The tag of a component with required models: a type parameter per required model takes the type
 * of its prop, which tells whether the tag passes it, so it does not need the signal then. The
 * compiled module and the editor's name the helper types differently.
 */
export function modelTagTypes(models: readonly ModelTypeSource[], value: (name: string) => string, helpers: { unbound: string; bound: string }): { parameters: string[]; props: string; bound: string } {
	const required = models.filter((model) => !model.optional)
	const parameter = (index: number): string => `__MeekoBound${index}`
	return {
		parameters: required.map((model, index) => `${parameter(index)} extends ${value(model.name)} | ${helpers.unbound} | undefined = ${helpers.unbound}`),
		props: required.length ? ` & { readonly ${required.map((model, index) => `${modelPropName(model.name)}?: ${parameter(index)}`).join('; readonly ')} }` : '',
		bound: required.length ? required.map((model, index) => `${helpers.bound}<${parameter(index)}, ${value(model.name)}, ${JSON.stringify(model.name)}>`).join(' | ') : 'never',
	}
}

export function emitComponentChannels(scriptParts: ChannelSource, generic: GenericParameters | undefined): { exposedType: string; channelsType: string } {
	const G = generic ? `<${markSource(generic.declaration, generic.offset)}>` : ''
	const A = generic ? `<${generic.names.join(', ')}>` : ''
	const exposedType = scriptParts.exposed ? `export type ComponentExposed${G} = ReturnType<typeof __setup${A}>[typeof __meeko.exposedKey];\n` : `export type ComponentExposed${G} = null;\n`
	const modelValue = (name: string): string => `__MeekoModels${A}[${JSON.stringify(name)}]`
	const modelsType = scriptParts.models.length ? `type __MeekoModels${G} = { ${scriptParts.models.map((model) => `${JSON.stringify(model.name)}: ${markSource(model.type, model.typeOffset)}`).join('; ')} };\nexport type ComponentModels${G} = { ${scriptParts.models.map((model) => `${JSON.stringify(model.name)}${model.optional ? '?' : ''}: __meeko.Signal<${modelValue(model.name)}>`).join('; ')} };\n` : `export type ComponentModels${G} = null;\n`
	const snippetsType = scriptParts.snippets ? `type __MeekoSnippets${G} = __meeko.SnippetTypes<${markSource(scriptParts.snippets.type, scriptParts.snippets.offset)}>;\nexport type ComponentSnippets${G} = __meeko.SnippetMap<__MeekoSnippets${A}>;\n` : `export type ComponentSnippets${G} = null;\n`
	// `__meekoGeneric` tells the type checks that the props of `renderToString` have their type parameters as `unknown`.
	const channelsDeclaration = generic ? `declare function __meeko_channels${G}(): { readonly models: ComponentModels${A}; readonly snippets: ComponentSnippets${A} };\nexport declare const __meekoChannels: ReturnType<typeof __meeko_channels>;\nexport declare const __meekoGeneric: true;\n` : 'export declare const __meekoChannels: { readonly models: ComponentModels; readonly snippets: ComponentSnippets };\n'
	const tag = modelTagTypes(scriptParts.models, modelValue, { unbound: '__meeko.ModelUnbound', bound: '__meeko.BoundModel' })
	const tagParameters = [...(generic ? [markSource(generic.declaration, generic.offset)] : []), ...tag.parameters]
	const tagGenerics = tagParameters.length ? `<${tagParameters.join(', ')}>` : ''
	const tagModels = scriptParts.models.length ? `NoInfer<__meeko.TagModels<ComponentModels${A}, ${tag.bound}>>` : '__meeko.NoModels'
	const tagSnippets = scriptParts.snippets ? `NoInfer<ComponentSnippets${A}>` : '__meeko.NoSnippets'
	const tagPropsType = 'type __MeekoTagProps<P> = P extends unknown ? { [K in keyof P]: {} extends Record<K, unknown> ? P[K] : {} extends Pick<P, K> ? P[K] | undefined : P[K] } : never;\n'
	const tagDeclaration = `${tagPropsType}export declare const __meekoTag: ${tagGenerics}(props: __MeekoTagProps<__MeekoComponentProps${A}> & __meeko.ExtraProps${tag.props}, events: NoInfer<__meeko.EventNames<__MeekoComponentProps${A}>>, models: ${tagModels}, snippets: ${tagSnippets}) => __meeko.TagInput<ComponentExposed${A}>;\n`
	return { exposedType, channelsType: `${modelsType}${snippetsType}${channelsDeclaration}${tagDeclaration}` }
}
