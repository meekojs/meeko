import ts from '@typescript/typescript6'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

import type { ApiErrorDetails, Schema, ServerManifest } from '../src/framework-server.ts'
import type { ApiOperation, RpcOperation } from '../src/framework.ts'

import { ApiError, createLocalServerFetch, createRequestContext, createServerClientOptions, defineApiRoute, defineRpc, dispatchApiRoute, dispatchRpc, errorResponse, MemorySessionStore, SessionManager } from '../src/framework-server.ts'
import { ClientError, createApiClient, createRpcClient, isClientError } from '../src/framework.ts'
import { normalizeServerError } from '../src/server/errors.ts'
import { withRequestContext } from '../src/server/runtime/request-context.ts'

const anything: Schema<{ version: number }> = { '~standard': { version: 1, validate: (value) => ({ value: value as { version: number } }) } }
const text: Schema<string> = { '~standard': { version: 1, validate: (value) => ({ value: value as string }) } }
const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false })

/** A `fetch` that answers every request with the local dispatch of `handler`. */
function localFetch(handler: (request: Request) => Promise<Response>): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as typeof fetch
}

test('an ApiError with details sends them in a 4xx from API and RPC, and keeps its message private', async () => {
	const route = defineApiRoute({
		body: anything,
		response: text,
		handler: () => {
			throw new ApiError('VERSION_CONFLICT', 409, { message: 'visit v-42 is stale (secret)', details: { actualVersion: 7 } })
		},
	})
	const request = new Request('http://localhost/api/visits', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: '{"version":6}' })
	const context = createRequestContext(request, {}, await sessions.load(request))
	const response = await dispatchApiRoute(route, context, sessions)
	assert.equal(response.status, 409)
	const payload = (await response.json()) as Record<string, unknown>
	assert.deepEqual(payload, { code: 'VERSION_CONFLICT', status: 409, requestId: context.requestId, details: { actualVersion: 7 } })
	assert.doesNotMatch(JSON.stringify(payload), /secret|v-42/)

	const rpc = defineRpc({
		input: anything,
		output: text,
		handler: () => {
			throw new ApiError('MODULE_DISABLED', 403, { issues: [{ path: '', message: 'Los descuentos no están activos.' }], details: { module: 'discounts' } })
		},
	})
	const call = new Request('http://localhost/_meeko/rpc/checkouts.create', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: '{}' })
	const rpcPayload = (await (await dispatchRpc(rpc, createRequestContext(call, {}, await sessions.load(call)), sessions)).json()) as Record<string, unknown>
	assert.deepEqual(rpcPayload.issues, [{ path: '', message: 'Los descuentos no están activos.' }])
	assert.deepEqual(rpcPayload.details, { module: 'discounts' })
})

test('details never travel with a 5xx, an unknown error or an ApiError without them', async () => {
	const server = (await errorResponse(new ApiError('UPSTREAM_DOWN', 503, { details: { host: 'db.internal' } }), 'r').json()) as Record<string, unknown>
	assert.deepEqual(Object.keys(server), ['code', 'status', 'requestId'])
	const unknown = Object.assign(new Error('boom'), { details: { secret: 1 } })
	assert.deepEqual(Object.keys((await errorResponse(unknown, 'r').json()) as object), ['code', 'status', 'requestId'])
	assert.deepEqual(Object.keys((await errorResponse(new ApiError('NOT_FOUND', 404), 'r').json()) as object), ['code', 'status', 'requestId'])
	const empty = (await errorResponse(new ApiError('EMPTY', 409, { details: {} }), 'r').json()) as Record<string, unknown>
	assert.deepEqual(empty.details, {}, 'an explicit empty object is still sent')
})

test('ApiError details must be a plain JSON object and are kept as a frozen copy', () => {
	const source = { actualVersion: 7, lines: [{ id: 'a', price: 1.5 }], note: null, ok: true }
	const error = new ApiError('PRICE_CONFLICT', 409, { details: source })
	assert.deepEqual(error.details, source)
	assert.notEqual(error.details, source)
	source.actualVersion = 8
	assert.equal(error.details?.actualVersion, 7, 'later changes to the original do not leak into the response')
	assert.ok(Object.isFrozen(error.details) && Object.isFrozen(error.details?.lines) && Object.isFrozen((error.details?.lines as readonly object[])[0]))
	assert.equal(error.message, 'PRICE_CONFLICT')

	const proto = new ApiError('X', 409, { details: JSON.parse('{"__proto__":{"admin":true}}') as ApiErrorDetails })
	assert.deepEqual(Object.keys(proto.details ?? {}), ['__proto__'], 'a __proto__ key stays data')
	assert.equal((proto.details as { admin?: unknown }).admin, undefined)

	const cyclic: Record<string, unknown> = {}
	cyclic.self = cyclic
	for (const details of [[1], 'text', null, new Date(), new Map(), { at: new Date() }, { n: Number.NaN }, { n: Infinity }, { f: () => 1 }, { u: undefined }, { b: 1n }, cyclic]) {
		assert.throws(() => new ApiError('X', 409, { details: details as unknown as ApiErrorDetails }), TypeError, String(details))
	}
})

test('details of another module graph ApiError survive the normalization; foreign ones do not', () => {
	class ApiErrorCopy extends Error {
		constructor(
			readonly code: string,
			readonly status: number,
			readonly details?: unknown,
			readonly issues?: unknown,
		) {
			super(code)
			this.name = 'ApiError'
			Object.defineProperty(this, Symbol.for('meeko.apiError'), { value: true })
		}
	}
	const copied = normalizeServerError(new ApiErrorCopy('VERSION_CONFLICT', 409, { actualVersion: 3 }))
	assert.deepEqual([copied.code, copied.status, copied.details], ['VERSION_CONFLICT', 409, { actualVersion: 3 }])
	const malformed = normalizeServerError(new ApiErrorCopy('VERSION_CONFLICT', 409, { at: new Date() }, [{ path: 'a', message: 'b' }]))
	assert.deepEqual([malformed.code, malformed.details, malformed.issues], ['VERSION_CONFLICT', undefined, [{ path: 'a', message: 'b' }]], 'malformed details are dropped, issues and the error are kept')

	class ForeignApiError extends Error {
		constructor(
			readonly code: string,
			readonly status: number,
			readonly details: unknown,
		) {
			super(code)
			this.name = 'ApiError'
		}
	}
	const foreign = normalizeServerError(new ForeignApiError('CONFLICT', 409, { token: 'sdk-secret' }))
	assert.deepEqual([foreign.code, foreign.status, foreign.details], ['CONFLICT', 409, undefined])
	const escaped = normalizeServerError(new ClientError('VERSION_CONFLICT', 409, 'req-1', undefined, { actualVersion: 1 }))
	assert.deepEqual([escaped.code, escaped.status, escaped.details], ['INTERNAL_ERROR', 500, undefined])
})

test('the rpc and api clients expose the details of a 4xx in ClientError', async () => {
	const update = defineRpc({
		input: anything,
		output: text,
		handler: () => {
			throw new ApiError('VERSION_CONFLICT', 409, { details: { actualVersion: 7, changedBy: { id: 'u1' } } })
		},
	})
	const rpc = createRpcClient<{ 'visits.update': RpcOperation<{ version: number }, string> }>({ rpc: [{ id: 'visits.update', pathname: '/_meeko/rpc/visits.update' }] }, { baseUrl: 'http://localhost', headers: { origin: 'http://localhost' }, fetch: localFetch(async (request) => dispatchRpc(update, createRequestContext(request, {}, await sessions.load(request)), sessions)) })
	const failure = await rpc.visits.update({ version: 6 }).catch((error: unknown) => error)
	assert.ok(isClientError(failure, 'VERSION_CONFLICT'))
	assert.equal(failure.status, 409)
	assert.deepEqual(failure.details, { actualVersion: 7, changedBy: { id: 'u1' } })
	assert.ok(Object.isFrozen(failure.details) && Object.isFrozen((failure.details as { changedBy: object }).changedBy))

	const route = defineApiRoute({
		response: text,
		handler: () => {
			throw new ApiError('MODULE_DISABLED', 403, { details: { module: 'reservations' } })
		},
	})
	const api = createApiClient<{ reservations: { get: ApiOperation<undefined, undefined, undefined, string> } }>({ api: [{ clientKey: 'reservations', method: 'GET', pathname: '/api/reservations' }] }, { baseUrl: 'http://localhost', fetch: localFetch(async (request) => dispatchApiRoute(route, createRequestContext(request, {}, await sessions.load(request)), sessions)) })
	const disabled = await api.reservations.get().catch((error: unknown) => error)
	assert.ok(isClientError(disabled, 'MODULE_DISABLED'))
	assert.deepEqual(disabled.details, { module: 'reservations' })
})

test('an SSR rpc call through the local dispatch receives the details', async () => {
	const manifest: ServerManifest = { api: [], rpc: [{ kind: 'rpc', file: 'reserve.ts', pathname: '/_meeko/rpc/tables/reserve', id: 'tables.reserve' }] }
	const reserve = defineRpc({
		input: anything,
		output: text,
		handler: () => {
			throw new ApiError('TABLE_TAKEN', 409, { details: { tableId: 't-3', until: '2026-11-23T21:00:00Z' } })
		},
	})
	const serverFetch = createLocalServerFetch({ manifest, sessions, load: async () => ({ default: reserve }) })
	const page = new Request('http://localhost/reservas')
	const context = createRequestContext(page, {}, await sessions.load(page))
	const rpc = createRpcClient<{ 'tables.reserve': RpcOperation<{ version: number }, string> }>(manifest, createServerClientOptions())
	const failure = await withRequestContext(context, serverFetch, () => rpc.tables.reserve({ version: 1 })).catch((error: unknown) => error)
	assert.ok(isClientError(failure, 'TABLE_TAKEN'))
	assert.deepEqual(failure.details, { tableId: 't-3', until: '2026-11-23T21:00:00Z' })
})

test('the client ignores details on a 5xx and anything that is not a JSON object', async () => {
	const body = (status: number, details: unknown): typeof fetch => localFetch(async () => new Response(JSON.stringify({ code: 'X', status, details }), { status, headers: { 'content-type': 'application/json' } }))
	const call = async (status: number, details: unknown): Promise<unknown> => {
		const rpc = createRpcClient<{ 'a.b': RpcOperation<undefined, string> }>({ rpc: [{ id: 'a.b', pathname: '/_meeko/rpc/a.b' }] }, { baseUrl: 'http://localhost', fetch: body(status, details) })
		const error = await rpc.a.b(undefined).catch((caught: unknown) => caught)
		assert.ok(error instanceof ClientError)
		return error.details
	}
	assert.equal(await call(502, { host: 'proxy' }), undefined)
	assert.equal(await call(409, [1, 2]), undefined)
	assert.equal(await call(409, 'text'), undefined)
	assert.equal(await call(409, null), undefined)
	assert.deepEqual(await call(409, { a: 1 }), { a: 1 })
	assert.equal(new ClientError('X', 409).details, undefined)
})

test('isClientError narrows details with the ClientErrorDetails registry', async () => {
	await mkdir(resolve('.meeko'), { recursive: true })
	const root = await mkdtemp(resolve('.meeko/api-error-details-types-'))
	const file = join(root, 'usage.ts')
	const clients = resolve('src/shared/clients.ts').replaceAll('\\', '/')
	const errors = resolve('src/server/errors.ts').replaceAll('\\', '/')
	try {
		await writeFile(
			file,
			`import { isClientError } from ${JSON.stringify(clients)};
import { ApiError } from ${JSON.stringify(errors)};
declare module ${JSON.stringify(clients)} {
  interface ClientErrorDetails { VERSION_CONFLICT: { readonly actualVersion: number } }
}
declare const error: unknown;
if (isClientError(error, "VERSION_CONFLICT")) {
  const version: number | undefined = error.details?.actualVersion;
  void version;
}
if (isClientError(error, "OTHER")) {
  const value: unknown = error.details;
  // @ts-expect-error unregistered codes keep unknown details
  void error.details.actualVersion;
  void value;
}
if (isClientError(error)) {
  // @ts-expect-error without a code, details stay unknown
  void error.details.actualVersion;
}
new ApiError("VERSION_CONFLICT", 409, { details: { actualVersion: 1, lines: [{ id: "a" }], note: null } });
// @ts-expect-error a Date is not JSON
new ApiError("X", 409, { details: { at: new Date() } });
// @ts-expect-error details is an object, not an array
new ApiError("X", 409, { details: [1] });
`,
		)
		const program = ts.createProgram({
			rootNames: [file],
			options: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true },
		})
		const source = program.getSourceFile(file)
		assert.ok(source)
		const diagnostics = [...program.getSemanticDiagnostics(source), ...program.getSyntacticDiagnostics(source)].map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
		assert.deepEqual(diagnostics, [])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
