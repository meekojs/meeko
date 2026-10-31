import { ESLintUtils } from "@typescript-eslint/utils";

import { template, visit } from "../template";

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
  name: "no-autofocus",
  meta: {
    type: "suggestion",
    docs: { description: "Evita autofocus en elementos HTML, que puede mover el foco sin intervención del usuario." },
    schema: [],
    hasSuggestions: true,
    messages: { unexpected: "Evita autofocus en este elemento HTML.", remove: "Quitar autofocus." },
  },
  defaultOptions: [],
  create(context) {
    return {
      "Program:exit"() {
        const body = template(context);
        if (!body) return;
        visit(body, (node) => {
          if (!node.tagName || node.componentName || node.tagName.includes("-")) return;
          const attribute = node.attrs?.find((entry) => entry.name === "autofocus");
          if (!attribute) return;
          context.report({
            loc: { start: context.sourceCode.getLocFromIndex(attribute.start), end: context.sourceCode.getLocFromIndex(attribute.end) },
            messageId: "unexpected",
            suggest: [{ messageId: "remove", fix: (fixer) => fixer.removeRange([attribute.start, attribute.end]) }],
          });
        });
      },
    };
  },
});
