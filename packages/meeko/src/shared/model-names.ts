/** Prop name of a model: the unnamed one, `default`, is `modelValue`; `touched` is `touched`. */
export function modelPropName(name: string): string {
	return name === 'default' ? 'modelValue' : name
}

/** Event of a model: `update:modelValue` for the unnamed one, `update:touched` for `touched`. */
export function modelEventName(name: string): string {
	return `update:${modelPropName(name)}`
}
