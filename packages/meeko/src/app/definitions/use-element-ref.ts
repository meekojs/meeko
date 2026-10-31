import ts from "@typescript/typescript6";
import { apiDocs, jsdoc } from "./compiler-docs";

/** A direct `useElementRef("name")` call in component setup. */
export interface ElementRefCall {
  readonly call: ts.CallExpression;
  readonly name: string;
  readonly nameNode: ts.StringLiteralLike;
  readonly awaited: boolean;
}

export class ElementRefError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

/** Checks the macro argument while the compiler walks the script. */
export function analyzeElementRefCall(call: ts.CallExpression, nested: boolean): ElementRefCall {
  const argument = call.arguments[0];
  if (call.arguments.length !== 1 || !argument || !ts.isStringLiteralLike(argument)) {
    throw new ElementRefError("MEEK056", "useElementRef necesita un literal de texto con el nombre de una directiva ref: de la plantilla, como useElementRef(\"input\")", argument ?? call);
  }
  return { call, name: argument.text, nameNode: argument, awaited: ts.isAwaitExpression(call.parent) && !nested };
}

/** Matches the call to its template ref before the compiler rewrites it. */
export function resolveElementRef<T extends { readonly list: boolean }>(call: ElementRefCall, refs: ReadonlyMap<string, T>): T {
  const ref = refs.get(call.name);
  if (!ref) {
    const known = [...refs.keys()].map((name) => `"${name}"`).join(", ");
    throw new ElementRefError("MEEK056", `La plantilla no tiene ref:${call.name}${known ? `; sus refs son ${known}` : "; añade ref:" + call.name + " a un elemento o a un componente"}`, call.nameNode);
  }
  if (ref.list && call.awaited) {
    throw new ElementRefError("MEEK056", `ref:${call.name} está dentro de each:of y nombra una lista; lee useElementRef("${call.name}").value en lugar de esperarla con await`, call.nameNode);
  }
  return ref;
}

/** A macro result must have one binding so the compiler can track its ref. */
export function validateElementRefBinding(callee: string | undefined, name: ts.BindingName): void {
  if (callee === "useElementRef") {
    throw new ElementRefError("MEEK015", "useElementRef no admite desestructuración: asigna la ref a un nombre simple, como const input = useElementRef(\"input\"), y lee input.value cuando la necesites", name);
  }
}

/** Type contract emitted into the editor's virtual component, with template-specific refs supplied there. */
export const useElementRefUnexposedEditorType = "type __MeekoUnexposedRef = { readonly value: null; then(meek080: \"MEEK080: esta ref nombra un componente sin defineExpose, así que no expone nada que esperar; añade defineExpose al componente o lee .value\"): never };";
export const useElementRefEditorDeclaration = "declare function useElementRef<K extends keyof __MeekoRefs>(name: K): K extends __MeekoListRefs ? { readonly value: readonly __MeekoRefs[K][] } : [__MeekoRefs[K]] extends [null] ? __MeekoUnexposedRef : { readonly value: __MeekoRefs[K] | null } & PromiseLike<__MeekoRefs[K]>;";

export const useElementRefDocs = jsdoc(
    "Macro de compilación: lee el elemento o el componente que la plantilla nombra con `ref:nombre`.",
    "Su tipo sale de la etiqueta (`HTMLElementTagNameMap` o `SVGElementTagNameMap`) o del `defineExpose`",
    "del componente.",
    "",
    "- Sin `await`, devuelve una señal de sólo lectura que vale `null` en SSR y mientras el destino no existe.",
    "- Con `await`, devuelve el destino, nunca `null`, y el resto del setup continúa sólo en el navegador.",
    "- Dentro de `each:of`, devuelve una señal con la lista de filas, que no admite `await`.",
    "",
    "Sólo en el nivel superior del script (`MEEK054`). El argumento es un literal con el nombre de una",
    "`ref:` de la plantilla (`MEEK056`).",
    "",
    "@since 1.1.0",
    "@example",
    "```html",
    "<script lang=\"ts\">",
    "const title = useElementRef(\"title\");",
    "onMounted(() => {",
    "  title.value?.scrollIntoView();",
    "});",
    "const field = await useElementRef(\"field\");",
    "// Desde aquí, sólo en el navegador y con el campo ya montado.",
    "field.focus();",
    "</script>",
    "<template><h2 ref:title>Buscar</h2><input ref:field /></template>",
    "```",
    `@see ${apiDocs}#referencias-a-elementos-ref-y-useelementref`,
  );
