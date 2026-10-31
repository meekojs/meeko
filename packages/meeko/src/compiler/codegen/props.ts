import type { GenericParameters } from "../generic";

import { markSource } from "../mapping";

interface PropsSource {
  propsType: string;
  propsTypeOffset: number | undefined;
  defaults?: { expression: string; offset: number; keys: readonly string[] };
  emits?: { type: string; offset: number };
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
  const P = generic ? "__P" : "T";
  const K = generic ? "__K" : "K";
  const ofParameters = generic ? `<${P}, ${markSource(generic.declaration, generic.offset)}>` : `<${P}>`;
  const ofArguments = (props: string): string => generic ? `<${props}, ${generic.names.join(", ")}>` : `<${props}>`;
  const propsDeclaration = emitsDeclaration + (defaults ? `type __MeekoDeclaredProps${G} = ${propsType};
type __MeekoDefaultKeys${G} = Extract<${defaultKeys}, keyof __MeekoDeclaredProps${A}>;
type __MeekoDefaultPick${G} = Pick<__MeekoDeclaredProps${A}, __MeekoDefaultKeys${A}>;
type __MeekoDefaultValues${G} = { [${K} in keyof __MeekoDefaultPick${A}]-?: Exclude<__MeekoDefaultPick${A}[${K}], undefined> };
type __MeekoResolvedPropsOf${ofParameters} = ${P} extends unknown ? Omit<${P}, __MeekoDefaultKeys${A}> & __MeekoDefaultValues${A} : never;
type __MeekoResolvedProps${G} = __MeekoResolvedPropsOf${ofArguments(`__MeekoDeclaredProps${A}`)};
type __MeekoInputPropsOf${ofParameters} = ${P} extends unknown ? Omit<${P}, __MeekoDefaultKeys${A}> & { [${K} in keyof __MeekoDefaultPick${A}]?: __MeekoDefaultPick${A}[${K}] | undefined } : never;
type __MeekoComponentProps${G} = __MeekoInputPropsOf${ofArguments(`__MeekoDeclaredProps${A}`)}${emitProps};
function __meeko_defaultProps${G}() {
  return (${markSource(defaults.expression, defaults.offset)} satisfies Partial<__MeekoDeclaredProps${A}> & __MeekoDefaultValues${A} & Record<Exclude<${defaultKeys}, keyof __MeekoDeclaredProps${A}>, never>);
}
function __meeko_resolveProps${G}(input: __MeekoComponentProps${A}): ${setupPropsType} {
  return __meeko.resolveProps(input, __meeko_defaultProps${A}()) as ${setupPropsType};
}` : plainPropsDeclaration) + "\nexport type { __MeekoComponentProps as ComponentProps };";
  return { setupPropsType, propsDeclaration };
}
