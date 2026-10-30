import type { GenericParameters } from "../generic.js";
import { markSource } from "../mapping.js";

interface ChannelSource {
  exposed: boolean;
  models: readonly { name: string; type: string; typeOffset: number; optional: boolean }[];
  snippets?: { type: string; offset: number };
}

export function emitComponentChannels(scriptParts: ChannelSource, generic: GenericParameters | undefined): { exposedType: string; channelsType: string } {
  const G = generic ? `<${markSource(generic.declaration, generic.offset)}>` : "";
  const A = generic ? `<${generic.names.join(", ")}>` : "";
  const exposedType = scriptParts.exposed
    ? `export type ComponentExposed${G} = ReturnType<typeof __setup${A}>[typeof __meeko.exposedKey];\n`
    : `export type ComponentExposed${G} = null;\n`;
  const modelsType = scriptParts.models.length
    ? `type __MeekoModels${G} = { ${scriptParts.models.map((model) => `${JSON.stringify(model.name)}: ${markSource(model.type, model.typeOffset)}`).join("; ")} };\nexport type ComponentModels${G} = { ${scriptParts.models.map((model) => `${JSON.stringify(model.name)}${model.optional ? "?" : ""}: __meeko.Signal<__MeekoModels${A}[${JSON.stringify(model.name)}]>`).join("; ")} };\n`
    : `export type ComponentModels${G} = null;\n`;
  const snippetsType = scriptParts.snippets
    ? `type __MeekoSnippets${G} = __meeko.SnippetTypes<${markSource(scriptParts.snippets.type, scriptParts.snippets.offset)}>;\nexport type ComponentSnippets${G} = __meeko.SnippetMap<__MeekoSnippets${A}>;\n`
    : `export type ComponentSnippets${G} = null;\n`;
  const channelsDeclaration = generic
    ? `declare function __meeko_channels${G}(): { readonly models: ComponentModels${A}; readonly snippets: ComponentSnippets${A} };\nexport declare const __meekoChannels: ReturnType<typeof __meeko_channels>;\n`
    : "export declare const __meekoChannels: { readonly models: ComponentModels; readonly snippets: ComponentSnippets };\n";
  const tagModels = scriptParts.models.length ? `NoInfer<ComponentModels${A}>` : "__meeko.NoModels";
  const tagSnippets = scriptParts.snippets ? `NoInfer<ComponentSnippets${A}>` : "__meeko.NoSnippets";
  const tagPropsType = "type __MeekoTagProps<P> = P extends unknown ? { [K in keyof P]: {} extends Record<K, unknown> ? P[K] : {} extends Pick<P, K> ? P[K] | undefined : P[K] } : never;\n";
  const tagDeclaration = `${tagPropsType}export declare const __meekoTag: ${G}(props: __MeekoTagProps<__MeekoComponentProps${A}> & __meeko.ExtraProps, events: NoInfer<__meeko.EventNames<__MeekoComponentProps${A}>>, models: ${tagModels}, snippets: ${tagSnippets}) => __meeko.TagInput<ComponentExposed${A}>;\n`;
  return { exposedType, channelsType: `${modelsType}${snippetsType}${channelsDeclaration}${tagDeclaration}` };
}
