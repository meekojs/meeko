import type { TSESLint } from "@typescript-eslint/utils";
import type { TemplateNode } from "@meekojs/meeko/parse";
import type { MeekoParserServices } from "./parser.js";

export function template(context: TSESLint.RuleContext<string, readonly unknown[]>): TemplateNode | undefined {
  const services = context.sourceCode.parserServices as Partial<MeekoParserServices>;
  return services.isMeeko ? services.templateBody : undefined;
}

export function visit(node: TemplateNode, callback: (node: TemplateNode) => void): void {
  callback(node);
  for (const child of [...node.childNodes ?? [], ...node.content?.childNodes ?? []]) visit(child, callback);
}
