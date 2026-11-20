import type { DataKey } from '../framework'
import type { RequestContext } from './runtime/request-context'

import { checkDataKeys, formatInvalidation, INVALIDATE_HEADER } from '../shared/invalidation'
import { invalidatedKeysOf } from './runtime/request-context'

/**
 * Records the static `invalidates` of a definition for this request. A handler adds more with
 * `context.invalidate()`. `finish` sends them only with a successful response, so a handler that
 * throws, or a response that fails its schema, invalidates nothing.
 */
export function recordInvalidates(definition: { readonly invalidates?: readonly DataKey[] | undefined }, context: RequestContext<unknown>, label: string): void {
	if (definition.invalidates === undefined) return
	const target = invalidatedKeysOf(context)
	for (const key of checkDataKeys(definition.invalidates, `${label} invalidates`)) target.add(key)
}

/** Adds `x-meeko-invalidate` to the successful answer of a write; reads and errors send nothing. */
export function setInvalidationHeader(response: Response, context: RequestContext<unknown>): void {
	if (!response.ok || ['GET', 'HEAD', 'OPTIONS'].includes(context.request.method)) return
	const keys = invalidatedKeysOf(context)
	if (!keys.size) return
	const value = formatInvalidation(keys)
	if (value) response.headers.set(INVALIDATE_HEADER, value)
}
