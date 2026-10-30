/**
 * Event map entry of `on:name` on a native element (HTML or SVG), or `Event` for a name the map
 * does not know. The editor declares it inline; the compiled component uses `EventOf` of the
 * package, which has the same definition.
 */
export const templateEventDeclaration = "type __MeekoEventOf<Name extends string, Svg extends boolean> = Svg extends true ? Name extends keyof SVGElementEventMap ? SVGElementEventMap[Name] : Event : Name extends keyof HTMLElementEventMap ? HTMLElementEventMap[Name] : Event;";

/**
 * Keeps CLI and editor callback contracts aligned for template events: the event of `on:name` on
 * a native element, with `currentTarget` typed as the element of the tag, like `ref:`. `prefix`
 * names the helpers of each side: `__meeko.` (`EventOf`, `ElementOf` of the package) in the
 * compiled component, `__Meeko` in the editor's virtual document. The intersection stays inline
 * so the editor's hover shows the event, not a helper name. `tagType`, a type expression such as
 * `typeof __meeko_tag_3`, replaces the tag for `<component is>`: `currentTarget` is then the
 * union of the elements of its possible tags.
 */
export function templateEventType(prefix: "__meeko." | "__Meeko", name: string, tag: string, svg: boolean, tagType?: string): string {
  return `${prefix}EventOf<${JSON.stringify(name)}, ${svg}> & { readonly currentTarget: ${prefix}ElementOf<${tagType ?? JSON.stringify(tag)}, ${svg}> }`;
}
