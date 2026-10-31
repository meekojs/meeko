import type { Linter, ESLint } from "eslint";
import typescript from "@typescript-eslint/eslint-plugin";
import parser from "./parser.js";
import buttonHasType from "./rules/button-has-type.js";
import noAutofocus from "./rules/no-autofocus.js";

const plugin: ESLint.Plugin & { configs: Record<string, Linter.Config[]> } = {
  meta: { name: "@meekojs/eslint-plugin", version: "0.1.0" },
  // utils 8 retains ESLint 9 context types while supporting ESLint 10 at runtime.
  rules: { "button-has-type": buttonHasType, "no-autofocus": noAutofocus } as unknown as ESLint.Plugin["rules"],
  configs: {},
};

plugin.configs.base = [{
  name: "meeko/base",
  files: ["**/*.meeko"],
  plugins: { meeko: plugin },
  languageOptions: {
    // TypeScript-ESLint's AST is extended with scope-only template wrappers.
    parser: parser as unknown as Linter.Parser,
    parserOptions: { project: false, projectService: false },
    globals: Object.fromEntries([
      "defineProps", "defineEmits", "defineExpose", "defineModel", "defineSnippets", "useElementRef",
      "MeekoLink", "MeekoOutlet", "MeekoAwait", "MeekoTeleport", "MeekoThemeToggle", "MeekoPopover", "MeekoSelect",
    ].map((name) => [name, "readonly" as const])),
  },
}];

plugin.configs.recommended = [
  ...plugin.configs.base,
  {
    name: "meeko/recommended",
    files: ["**/*.meeko"],
    plugins: { "@typescript-eslint": typescript as unknown as ESLint.Plugin },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "meeko/button-has-type": "warn",
      "meeko/no-autofocus": "warn",
    },
  },
];

export default plugin;
export { parser };
