import { basename } from "node:path";
import { locate } from "../parser/sfc";

export function emitComponentRelease(source: string, filename: string, declarations: ReadonlyMap<string, number>, exposed: boolean, hot: boolean): string {
  const exposedValue = exposed ? ", __bindings[__meeko.exposedKey]" : "";
  const devtoolsSites = hot
    ? `{ ${[...declarations].map(([name, offset]) => { const point = locate(source, offset); return `${JSON.stringify(name)}: { line: ${point.line}, column: ${point.column} }`; }).join(", ")} }`
    : "";
  return hot
    ? `const __cleanup = () => __meeko.finishWithCleanup(__release, __meeko_dispose);\nconst __component = { renderToString, hydrate, hydrateScope, css };\nconst __snapshot = () => __meeko.snapshotSignals(__bindings);\nconst __devtoolsStop = __meeko.registerDevtoolsInstance({ componentId: __hotId, name: ${JSON.stringify(basename(filename, ".meeko"))}, file: ${JSON.stringify(filename)}, scope: __scope, props: __inputProps, bindings: __bindings, sites: ${devtoolsSites} });\nconst __dispose = () => __meeko.finishWithCleanup(__cleanup, __devtoolsStop);\nconst __stop = __hotRoot ? __meeko.registerHotInstance(__hotId, __hotRoot, __inputProps, __component, __snapshot, __dispose) : __scope.start ? __meeko.registerHotScope(__hotId, __scope, __inputProps, __component, __snapshot, __dispose) : __dispose;\nreturn __meeko.withStateSnapshot(__stop, __snapshot${exposedValue});`
    : `return __meeko.withStateSnapshot(() => __meeko.finishWithCleanup(__release, __meeko_dispose), () => __meeko.snapshotSignals(__bindings)${exposedValue});`;
}
