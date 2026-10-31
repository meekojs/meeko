import { defineEslint } from "@meekojs/eslint-plugin";

export default defineEslint({
  perfectionist: true,
  unusedImports: true,
  rules: {
    "meeko/button-has-type": "error",
  },
});
