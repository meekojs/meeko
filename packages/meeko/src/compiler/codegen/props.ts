import type { GenericParameters } from "../generic";

import { markSource } from "../mapping";

/** The defaults of `defineProps`: the argument, or the defaults of a destructuring. */
export interface PropsDefaultsCode {
  /** An object literal; already marked when `marked` (the defaults of a destructuring). */
  expression: string;
  offset: number;
  keys: readonly string[];
  marked?: boolean;
  /** Top-level constants of the script that the defaults read, evaluated again with them. */
  constants?: readonly string[];
  /** Literal type of each default that is a literal (`kind = "a"`), by prop (see `propsDefaultLiteralTypes`). */
  literals?: Readonly<Record<string, string>>;
  /** Offset and length of the prop name of each default, where its `MEEK131` check reports. */
  keyRanges?: Readonly<Record<string, readonly [offset: number, length: number]>>;
}

/** Text of the `MEEK131` type error: a default that is not a literal and that some member of a union that requires its prop does not admit. */
const fitMessage = (key: string): string => `MEEK131: el valor por defecto de ${key} no es un literal y alguna variante de las props exige ${key} con un valor que no lo admite; escribe un literal, como ${key} = 'valor', o una constante de nivel superior con un literal: así ${key} sólo es opcional en las variantes que admiten ese valor`;

interface PropsSource {
  propsType: string;
  propsTypeOffset: number | undefined;
  defaults?: PropsDefaultsCode;
  emits?: { type: string; offset: number };
}

/**
 * `__MeekoDefaultLiteral<P, K>`: the literal type of the default of `K` (`kind = "a"` is `"a"`).
 * It depends on the member `P` so that TypeScript creates the literal after the props' own types:
 * otherwise the union of the props prints in another order (`"md" | "sm"` for `"sm" | "md"`).
 * The editor declares the same type (`language-server/model.ts`).
 */
export function defaultLiteralType(literals: Readonly<Record<string, string>>): string {
  return `type __MeekoDefaultLiteral<P, K> = P extends unknown ? ${Object.entries(literals).map(([key, type]) => `K extends ${JSON.stringify(key)} ? ${type} : `).join("")}never : never;`;
}

export function emitComponentProps(scriptParts: PropsSource, generic: GenericParameters | undefined): { setupPropsType: string; propsDeclaration: string } {
  const G = generic ? `<${markSource(generic.declaration, generic.offset)}>` : "";
  const A = generic ? `<${generic.names.join(", ")}>` : "";
  const propsType = scriptParts.propsTypeOffset === undefined ? scriptParts.propsType : markSource(scriptParts.propsType, scriptParts.propsTypeOffset);
  const defaults = scriptParts.defaults;
  const emits = scriptParts.emits;
  const defaultKeys = defaults?.keys.map((key) => JSON.stringify(key)).join(" | ") || "never";
  const emitsDeclaration = emits ? `type __MeekoEmits${G} = __meeko.Emits<${markSource(emits.type, emits.offset)}>;\ntype __MeekoEmitProps${G} = __meeko.EmitProps<__MeekoEmits${A}>;\n` : "";
  const emitProps = emits ? ` & __MeekoEmitProps${A}` : "";
  const setupPropsType = defaults ? `__MeekoResolvedProps${A}${emitProps}` : emits ? `__MeekoComponentProps${A}` : propsType;
  const plainPropsDeclaration = !emits
    ? `type __MeekoComponentProps${G} = ${propsType};`
    : scriptParts.propsTypeOffset === undefined
      ? `type __MeekoComponentProps${G} = __MeekoEmitProps${A};`
      : `type __MeekoDeclaredProps${G} = ${propsType};\ntype __MeekoComponentProps${G} = __MeekoDeclaredProps${A} & __MeekoEmitProps${A};`;
  // A default that is not a literal is optional in every member that declares its prop; in a
  // union, each member that requires the prop must admit it (`MEEK131`, on the prop's name).
  // Not for a generic component, whose members are only known for each instantiation.
  const literals = defaults?.literals ?? {};
  const literalKeys = Object.keys(literals);
  const opaque = generic ? [] : defaults?.keys.filter((key) => !Object.hasOwn(literals, key)) ?? [];
  const fitDeclarations = opaque.length
    ? "type __MeekoRequiredDefault<P, K extends PropertyKey> = (P extends unknown ? K extends keyof P ? {} extends Pick<P, K> ? never : (value: P[K]) => void : never : never) extends (value: infer I) => void ? I : unknown;\n"
      + `type __MeekoDefaultFit<K extends string> = K extends keyof __MeekoDefaultValues ? [__MeekoDefaultValues[K]] extends [__MeekoRequiredDefault<__MeekoDeclaredProps, K>] ? unknown : { [P in K]: __MeekoRequiredDefault<__MeekoDeclaredProps, K> | __MeekoDefaultFitMessage<K> } : unknown;\n`
      + `type __MeekoDefaultFitMessage<K extends string> = ${opaque.map((key) => `K extends ${JSON.stringify(key)} ? ${JSON.stringify(fitMessage(key))} : `).join("")}never;\n`
    : "";
  const fitChecks = opaque.map((key) => {
    const range = defaults?.keyRanges?.[key];
    const check = `satisfies __MeekoDefaultFit<${JSON.stringify(key)}>`;
    return ` ${range ? markSource(check, range[0], range[1]) : check})`;
  });
  const P = generic ? "__P" : "T";
  const K = generic ? "__K" : "K";
  const ofParameters = generic ? `<${P}, ${markSource(generic.declaration, generic.offset)}>` : `<${P}>`;
  const fittingDeclaration = literalKeys.length
    ? `${defaultLiteralType(literals)}
type __MeekoFittingDefaultKeys${ofParameters} = { [${K} in __MeekoDefaultKeys${A} & keyof ${P}]: ${K} extends ${literalKeys.map((key) => JSON.stringify(key)).join(" | ")} ? Exclude<${P}[${K}], undefined> extends infer __V ? [__MeekoDefaultLiteral<${P}, ${K}>] extends [__V] ? ${K} : never : never : ${K} }[__MeekoDefaultKeys${A} & keyof ${P}];`
    : `type __MeekoFittingDefaultKeys${ofParameters} = __MeekoDefaultKeys${A} & keyof ${P};`;
  const ofArguments = (props: string): string => generic ? `<${props}, ${generic.names.join(", ")}>` : `<${props}>`;
  // Each member of a union of props on its own: a default makes its prop optional for the parent
  // only in the members whose type admits the default's value, so `kind = "a"` does not let the
  // parent omit `kind: "b"` of another member (`__MeekoFittingDefaultKeys`).
  const propsDeclaration = emitsDeclaration + (defaults ? `type __MeekoDeclaredProps${G} = ${propsType};
type __MeekoDefaultKeys${G} = Extract<${defaultKeys}, keyof __MeekoDeclaredProps${A}>;
type __MeekoDefaultPick${G} = Pick<__MeekoDeclaredProps${A}, __MeekoDefaultKeys${A}>;
type __MeekoDefaultValues${G} = { [${K} in keyof __MeekoDefaultPick${A}]-?: Exclude<__MeekoDefaultPick${A}[${K}], undefined> };
type __MeekoResolvedPropsOf${ofParameters} = ${P} extends unknown ? Omit<${P}, __MeekoDefaultKeys${A}> & { [${K} in keyof Pick<${P}, __MeekoDefaultKeys${A} & keyof ${P}>]-?: Exclude<${P}[${K}], undefined> } : never;
type __MeekoResolvedProps${G} = __MeekoResolvedPropsOf${ofArguments(`__MeekoDeclaredProps${A}`)};
${fittingDeclaration}
${fitDeclarations}type __MeekoInputPropsOf${ofParameters} = ${P} extends unknown ? Omit<${P}, __MeekoFittingDefaultKeys${ofArguments(P)}> & { [${K} in keyof Pick<${P}, __MeekoFittingDefaultKeys${ofArguments(P)}>]?: ${P}[${K}] | undefined } : never;
type __MeekoComponentProps${G} = __MeekoInputPropsOf${ofArguments(`__MeekoDeclaredProps${A}`)}${emitProps};
function __meeko_defaultProps${G}() {
${defaults.constants?.map((constant) => `${constant}\n`).join("") ?? ""}  return ${fitChecks.map(() => "(").join("")}(${defaults.marked ? defaults.expression : markSource(defaults.expression, defaults.offset)} satisfies Partial<__MeekoDeclaredProps${A}> & __MeekoDefaultValues${A} & Record<Exclude<${defaultKeys}, keyof __MeekoDeclaredProps${A}>, never>)${fitChecks.join("")};
}
function __meeko_resolveProps${G}(input: __MeekoComponentProps${A}): ${setupPropsType} {
  return __meeko.resolveProps(input, __meeko_defaultProps${A}()) as ${setupPropsType};
}` : plainPropsDeclaration) + "\nexport type { __MeekoComponentProps as ComponentProps };";
  return { setupPropsType, propsDeclaration };
}
