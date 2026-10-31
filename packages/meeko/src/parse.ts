/** Parsing primitives shared by language tools; they never execute project configuration. */
export { parseSfc, locate, MeekoCompileError } from "./compiler/parser/sfc.js";
export type { CompileDiagnostic, SfcDocument, SfcSection, SourceLocation } from "./compiler/parser/sfc.js";
export { parseTemplate, attributeValueStart, decodeTemplateText, isCustomElementTag } from "./compiler/parser/template.js";
export type { TemplateNode, TemplateAttribute } from "./compiler/parser/template.js";
export { scanInterpolations } from "./compiler/parser/interpolation.js";
export type { InterpolationScan, InterpolationSegment } from "./compiler/parser/interpolation.js";
