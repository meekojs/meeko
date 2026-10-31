import type { SfcSection } from "@meekojs/meeko/parse";

import { parseSfc } from "@meekojs/meeko/parse";
import { ESLintUtils } from "@typescript-eslint/utils";

import { template } from "../template";

const names = ["server", "script", "template", "style"] as const;
export type SectionName = typeof names[number];

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
  name: "order-sections",
  meta: {
    type: "layout",
    docs: { description: "Ordena las secciones de un componente Meeko sin modificar su contenido." },
    fixable: "code",
    schema: [{ type: "object", properties: { order: { type: "array", items: { type: "string", enum: [...names] }, uniqueItems: true, minItems: 1 } }, additionalProperties: false }],
    messages: { order: "La sección {{name}} debe aparecer antes de {{previous}}." },
  },
  defaultOptions: [{}] as [{ order?: SectionName[] }],
  create(context, [options]) {
    return {
      "Program:exit"() {
        if (!template(context)) return;
        const source = context.sourceCode;
        const document = parseSfc(source.text, context.filename);
        const order = [...options.order ?? [], ...names.filter((name) => !options.order?.includes(name))];
        const sections = [document.server, document.script, document.template, document.style]
          .filter((section): section is SfcSection => section !== undefined && !section.implicit).sort((a, b) => a.start - b.start);
        const sorted = [...sections].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
        const mismatch = sections.findIndex((section, index) => section !== sorted[index]);
        if (mismatch < 0) return;
        const first = sections[0]!;
        const last = sections.at(-1)!;
        const gaps = sections.slice(1).map((section, index) => source.text.slice(sections[index]!.end, section.start));
        // Outside comments may describe a section; leave their ownership to the author.
        const safe = [...gaps, source.text.slice(0, first.start), source.text.slice(last.end)].every((gap) => /^\s*$/.test(gap));
        const misplaced = sorted[mismatch]!;
        context.report({
          loc: { start: source.getLocFromIndex(misplaced.start), end: source.getLocFromIndex(misplaced.contentStart) },
          messageId: "order",
          data: { name: misplaced.name, previous: sections[mismatch]!.name },
          fix: safe ? (fixer) => fixer.replaceTextRange([first.start, last.end], sorted.map((section, index) => source.text.slice(section.start, section.end) + (gaps[index] ?? "")).join("")) : null,
        });
      },
    };
  },
});
