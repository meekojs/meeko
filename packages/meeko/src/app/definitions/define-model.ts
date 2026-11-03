import ts from '@typescript/typescript6'

import { modelEventName, modelPropName } from '../../shared/model-names'

/** `const name = defineModel<T>(modelName?, options?)` accepted by the compiler. */
export interface ModelDeclaration {
	readonly declaration: ts.VariableDeclaration & { readonly name: ts.Identifier }
	readonly call: ts.CallExpression
	/** `default` for `defineModel<T>()`, or the literal name of a named model. */
	readonly name: string
	readonly typeArgument: ts.TypeNode
	/** `{ default: value }`, if the model has a default. */
	readonly options?: ts.ObjectLiteralExpression
}

export class ModelError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly node: ts.Node,
	) {
		super(message)
	}
}

/** Whether `node` is the identifier of a `defineModel` reference, not a property name. */
function isMacroReference(node: ts.Node): node is ts.Identifier {
	if (!ts.isIdentifier(node) || node.text !== 'defineModel') return false
	const parent = node.parent
	if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
	if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false
	return true
}

/** Whether an options object only has `default`, written as a property or shorthand. */
function defaultOnly(options: ts.ObjectLiteralExpression): ts.Node | undefined {
	const names = new Set<string>()
	for (const property of options.properties) {
		const name = (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined
		if (name !== 'default' || names.has(name)) return property
		names.add(name)
	}
	return names.has('default') ? undefined : options
}

/** The members that a type of this script spells: a literal, an intersection, or a local `type` or `interface`; not an imported one. */
function spelledMembers(type: ts.TypeNode, file: ts.SourceFile, seen = new Set<ts.Node>()): ts.TypeElement[] {
	if (ts.isTypeLiteralNode(type)) return [...type.members]
	if (ts.isParenthesizedTypeNode(type)) return spelledMembers(type.type, file, seen)
	if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) return type.types.flatMap((member) => spelledMembers(member, file, seen))
	if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return []
	const name = type.typeName.text
	return file.statements.flatMap((statement) => {
		if ((!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) || statement.name.text !== name || seen.has(statement)) return []
		seen.add(statement)
		return ts.isInterfaceDeclaration(statement) ? [...statement.members] : spelledMembers(statement.type, file, seen)
	})
}

/** The name of a type member, when it is written as a name or a string. */
function memberName(member: ts.TypeElement): string | undefined {
	return member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : undefined
}

/** The type argument of the `defineProps<T>()` or `defineEmits<T>()` of a statement. */
function macroType(statement: ts.Statement, macro: string): ts.TypeNode | undefined {
	const call = ts.isVariableStatement(statement) ? statement.declarationList.declarations[0]?.initializer : ts.isExpressionStatement(statement) ? statement.expression : undefined
	return call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === macro ? call.typeArguments?.[0] : undefined
}

/**
 * `MEEK063`: a model owns its prop and its event, so the script cannot also declare them. Only what
 * the script spells: a wrapper can take the props of the component it wraps (`defineProps<UIInputProps>()`),
 * which know its `modelValue`, and declare its own model.
 */
function rejectModelMembers(models: readonly ModelDeclaration[], file: ts.SourceFile): void {
	if (!models.length) return
	const spelling = (name: string): string => (name === 'default' ? 'defineModel<T>()' : `defineModel<T>("${name}")`)
	for (const statement of file.statements) {
		for (const member of spelledMembers(macroType(statement, 'defineProps') ?? macroType(statement, 'defineEmits') ?? ts.factory.createTypeLiteralNode([]), file)) {
			const name = memberName(member)
			const model = models.find((candidate) => modelPropName(candidate.name) === name || modelEventName(candidate.name) === name)
			if (!model) continue
			throw new ModelError('MEEK063', `${name} ya es de ${spelling(model.name)}: el padre pasa bind:${modelPropName(model.name)} y on:${modelEventName(model.name)}, y el hijo lee y escribe el modelo; quítalo de ${macroType(statement, 'defineProps') ? 'defineProps' : 'defineEmits'}`, member)
		}
	}
}

/**
 * Finds the `defineModel` calls of a script. Each one is its own top-level `const` with a simple
 * name, one type argument, an optional literal model name and optional `{ default }` options;
 * each model name appears once.
 */
export function analyzeModels(file: ts.SourceFile): ModelDeclaration[] {
	const found: ModelDeclaration[] = []
	const visit = (node: ts.Node): void => {
		if (isMacroReference(node)) {
			const call = node.parent
			const declaration = ts.isCallExpression(call) && call.expression === node ? call.parent : undefined
			const list = declaration && ts.isVariableDeclaration(declaration) ? declaration.parent : undefined
			const valid = declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer === call && ts.isIdentifier(declaration.name) && list !== undefined && ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0 && list.declarations.length === 1 && ts.isVariableStatement(list.parent) && ts.isSourceFile(list.parent.parent)
			if (!valid) throw new ModelError('MEEK063', 'defineModel debe ir en su propia declaración const de nivel superior con un nombre simple', node)
			const typed = call as ts.CallExpression
			if (typed.typeArguments?.length !== 1) throw new ModelError('MEEK064', 'defineModel necesita un argumento de tipo, como defineModel<string>()', typed)
			const [first, second, extra] = typed.arguments
			if (extra) throw new ModelError('MEEK064', 'defineModel admite un nombre de modelo y unas opciones: defineModel<T>("name", { default: value })', extra)
			let nameNode: ts.Expression | undefined
			let options: ts.Expression | undefined
			if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
				nameNode = first
				options = second
			} else if (first && second) {
				throw new ModelError('MEEK064', 'El nombre de modelo de defineModel debe ser un literal de texto, como defineModel<boolean>("open")', first)
			} else options = first
			const name = nameNode && (ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode)) ? nameNode.text : 'default'
			if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new ModelError('MEEK063', `Nombre de modelo no válido: "${name}"; usa un identificador, como "open"`, nameNode ?? typed)
			if (options && !ts.isObjectLiteralExpression(options)) {
				throw new ModelError('MEEK064', 'defineModel recibe un nombre como literal de texto y un objeto literal: defineModel<T>("name", { default: value })', options)
			}
			if (options) {
				const invalid = defaultOnly(options)
				if (invalid) throw new ModelError('MEEK064', 'Las opciones de defineModel sólo admiten default: { default: value }', invalid)
			}
			const previous = found.find((model) => modelPropName(model.name) === modelPropName(name))
			if (previous) {
				throw new ModelError('MEEK063', modelPropName(name) === 'modelValue' ? 'El modelo default, cuya prop es modelValue, ya está declarado; da otro nombre a los demás modelos: defineModel<T>("name")' : `El modelo "${name}" ya está declarado`, nameNode ?? typed)
			}
			found.push({
				declaration: declaration as ModelDeclaration['declaration'],
				call: typed,
				name,
				typeArgument: typed.typeArguments[0]!,
				...(options ? { options } : {}),
			})
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	rejectModelMembers(found, file)
	return found
}

import { jsdoc } from './compiler-docs'

export const defineModelDocs = jsdoc(
	'Macro de compilación: declara un modelo, una señal escribible que el padre comparte con',
	'`model="señal"` (el modelo sin nombre) o `model:nombre="señal"`. El hijo lee y escribe la señal del',
	'padre; si el padre no pasa ninguna, usa una señal local creada con `default`. Un modelo sin',
	'`default` es obligatorio para el padre. El modelo sin nombre recibe las opciones solas:',
	'`defineModel<string>({ default: "" })` lo hace opcional.',
	'',
	'Desde 1.8 el padre también puede pasar el valor como prop, con `bind:modelValue` (o `bind:nombre`) o',
	'dentro de `bind="objeto"`, y escuchar `on:update:modelValue` (u `on:update:nombre`). El hijo sigue a la',
	'prop; con prop y evento a la vez, una escritura sólo llama al evento y el valor cambia si el padre',
	'cambia la prop; sin evento, la escritura se queda en el hijo. El hijo no distingue las formas.',
	'',
	'Va en su propia declaración `const` de nivel superior y cada nombre se declara una sola vez. Su prop',
	'y su evento son del modelo: `defineProps` y `defineEmits` no pueden declararlos (`MEEK063`).',
	'',
	'@since 1.1.0',
	'@example',
	'```html',
	'<!-- Toggle.meeko -->',
	'<script lang="ts">',
	'const open = defineModel<boolean>("open", { default: false });',
	'</script>',
	'<template><button on:click="() => open.value = !open.value">{open.value ? "Cerrar" : "Abrir"}</button></template>',
	'',
	'<!-- En el padre, con const visible = signal(true) -->',
	'<Toggle model:open="visible" />',
	'<!-- O por prop y evento -->',
	'<Toggle bind:open="visible.value" on:update:open="(next) => (visible.value = next)" />',
	'```',
)
/** Options of `defineModel`: a `default` makes the model optional. */
export interface ModelOptions<T> {
	readonly default: T
}
