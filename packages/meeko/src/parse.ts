/** Parsing primitives shared by language tools; they never execute project configuration. */
export { parseSfc, locate, MeekoCompileError, isSelfClosableElement, maskComponentTags } from "./compiler/parser/sfc";
export type { CompileDiagnostic, SfcDocument, SfcSection, SourceLocation } from "./compiler/parser/sfc";
export { parseTemplate, attributeValueStart, decodeTemplateText, isCustomElementTag } from "./compiler/parser/template";
export type { TemplateNode, TemplateAttribute } from "./compiler/parser/template";
export { scanInterpolations } from "./compiler/parser/interpolation";
export type { InterpolationScan, InterpolationSegment } from "./compiler/parser/interpolation";
