import type { Linter } from "eslint";
import type { ESLintRules } from "eslint/rules";

import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import perfectionist from "eslint-plugin-perfectionist";
import unusedImports from "eslint-plugin-unused-imports";

import type { PerfectionistRules, UnusedImportsRules } from "./optional-rules";
import type { MacroName } from "./rules/order-macros";
import type { SectionName } from "./rules/order-sections";
import type { TypeScriptRules } from "./typescript-rules.generated";

import plugin from "./plugin";

/** Keep literal core rule keys and their official options; discard RulesRecord's open index. */
type CoreRules = { [Name in keyof ESLintRules as string extends Name ? never : Name]: ESLintRules[Name] };

/** Known core, TypeScript-ESLint and Meeko rules, with their options and no catch-all key. */
export type DefineEslintRules = Partial<CoreRules & TypeScriptRules & PerfectionistRules & UnusedImportsRules & {
  "meeko/button-has-type": Linter.RuleEntry<[]>;
  "meeko/no-autofocus": Linter.RuleEntry<[]>;
  "meeko/order-macros": Linter.RuleEntry<[{ order?: MacroName[] }]>;
  "meeko/order-sections": Linter.RuleEntry<[{ order?: SectionName[] }]>;
  "meeko/prefer-static-bindings": Linter.RuleEntry<[]>;
}>;

export interface DefineEslintOptions {
  /** Lint .js, .mjs and .cjs with ESLint recommended. Default true. */
  javascript?: boolean;
  /** Lint .ts, .tsx, .mts and .cts with syntax-only TypeScript recommended. Default true. */
  typescript?: boolean;
  /** Lint .meeko scripts and templates with their own parser. Default true. */
  meeko?: boolean;
  /** Sort import declarations and named imports naturally, ascending. Default false. */
  perfectionist?: boolean;
  /** Remove unused imports and report other unused variables once. Default false. */
  unusedImports?: boolean;
  /** Additional global ignore patterns; defaults already exclude generated Meeko/build folders. */
  ignores?: string[];
  /** Rules apply only to enabled languages that own the respective rule namespace. */
  rules?: DefineEslintRules;
}

const javascriptFiles = ["**/*.{js,mjs,cjs}"];
const typeScriptFiles = ["**/*.{ts,tsx,mts,cts}"];
const meekoFiles = ["**/*.meeko"];
const defaults = ["**/node_modules/**", "**/dist/**", "**/.meeko/**", "**/*.d.meeko.ts", "**/*.generated.ts"];

/**
 * Create a standard Flat Config array. No config files are generated and no project is loaded.
 * The last overrides have the same precedence as normal ESLint configuration objects.
 */
export function defineEslint<const Rules extends DefineEslintRules = DefineEslintRules>(
  options: Omit<DefineEslintOptions, "rules"> & { rules?: Rules & Record<Exclude<keyof Rules, keyof DefineEslintRules>, never> } = {},
  ...overrides: Linter.Config[]
): Linter.Config[] {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("defineEslint options must be an object");
  for (const key of Object.keys(options)) if (!["javascript", "typescript", "meeko", "perfectionist", "unusedImports", "ignores", "rules"].includes(key)) throw new TypeError(`defineEslint: unknown option ${key}`);
  for (const key of ["javascript", "typescript", "meeko", "perfectionist", "unusedImports"] as const) if (options[key] !== undefined && typeof options[key] !== "boolean") throw new TypeError(`defineEslint: ${key} must be a boolean`);
  const javascript = options.javascript ?? true;
  const ts = options.typescript ?? true;
  const meeko = options.meeko ?? true;
  if (!javascript && !ts && !meeko) throw new TypeError("defineEslint: enable at least one language");
  if (options.ignores !== undefined && (!Array.isArray(options.ignores) || options.ignores.some((ignore) => typeof ignore !== "string"))) throw new TypeError("defineEslint: ignores must be an array of strings");
  if (options.rules !== undefined && (!options.rules || typeof options.rules !== "object" || Array.isArray(options.rules))) throw new TypeError("defineEslint: rules must be an object");
  const files = [...javascript ? javascriptFiles : [], ...ts ? typeScriptFiles : [], ...meeko ? meekoFiles : []];
  const typedFiles = [...ts ? typeScriptFiles : [], ...meeko ? meekoFiles : []];
  const config: Linter.Config[] = [{ name: "meeko/ignores", ignores: [...defaults, ...options.ignores ?? []] }];
  // TS recommended builds on eslint:recommended even when standalone JS linting is disabled.
  config.push({ name: "meeko/javascript-recommended", files, rules: js.configs.recommended.rules });
  if (ts) {
    // The public plugin types still describe legacy configs; flat/recommended is a documented
    // runtime export and contains only syntax-based rules, never projectService or a TS program.
    const recommended = typescript.configs["flat/recommended"] as unknown as Linter.Config[];
    config.push(...recommended.map((entry) => ({ ...entry, files: typeScriptFiles })));
  }
  if (meeko) config.push(...plugin.configs.recommended);
  if (options.perfectionist) config.push({
    name: "meeko/perfectionist",
    files,
    plugins: { perfectionist },
    rules: {
      "perfectionist/sort-imports": ["error", { type: "natural", order: "asc", sortSideEffects: false, useExperimentalDependencyDetection: false }],
      "perfectionist/sort-named-imports": ["error", { type: "natural", order: "asc" }],
    },
  });
  if (options.unusedImports) config.push({
    name: "meeko/unused-imports",
    files,
    plugins: { "unused-imports": unusedImports },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": ["error", { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" }],
    },
  });
  const core: Linter.RulesRecord = {};
  const tsRules: Linter.RulesRecord = {};
  const meekoRules: Linter.RulesRecord = {};
  const optionalRules: Linter.RulesRecord = {};
  for (const [name, value] of Object.entries(options.rules ?? {})) {
    const level = Array.isArray(value) ? value[0] : value;
    if (options.unusedImports && (name === "no-unused-vars" || name === "@typescript-eslint/no-unused-vars") && level !== "off" && level !== 0) {
      throw new TypeError(`defineEslint: ${name} conflicts with unusedImports; configure unused-imports/no-unused-vars instead`);
    }
    if (name.startsWith("meeko/")) {
      if (!meeko) throw new TypeError(`defineEslint: ${name} requires meeko`);
      if (!Object.hasOwn(plugin.rules ?? {}, name.slice("meeko/".length))) throw new TypeError(`defineEslint: unknown rule ${name}`);
      meekoRules[name] = value;
    } else if (name.startsWith("@typescript-eslint/")) {
      if (!ts && !meeko) throw new TypeError(`defineEslint: ${name} requires typescript or meeko`);
      if (!Object.hasOwn(typescript.rules, name.slice("@typescript-eslint/".length))) throw new TypeError(`defineEslint: unknown rule ${name}`);
      const severity = Array.isArray(value) ? value[0] : value;
      if (severity !== "off" && severity !== 0 && typescript.rules[name.slice("@typescript-eslint/".length)].meta.docs?.requiresTypeChecking) {
        throw new TypeError(`defineEslint: ${name} requires type information; configure it in a TypeScript override with projectService instead of options.rules`);
      }
      tsRules[name] = value;
    } else if (name.startsWith("perfectionist/")) {
      if (!options.perfectionist) throw new TypeError(`defineEslint: ${name} requires perfectionist`);
      if (!Object.hasOwn(perfectionist.rules ?? {}, name.slice("perfectionist/".length))) throw new TypeError(`defineEslint: unknown rule ${name}`);
      optionalRules[name] = value;
    } else if (name.startsWith("unused-imports/")) {
      if (!options.unusedImports) throw new TypeError(`defineEslint: ${name} requires unusedImports`);
      if (!Object.hasOwn(unusedImports.rules ?? {}, name.slice("unused-imports/".length))) throw new TypeError(`defineEslint: unknown rule ${name}`);
      optionalRules[name] = value;
    } else if (name.includes("/")) {
      throw new TypeError(`defineEslint: unknown rule namespace ${name}; configure additional plugins in an override`);
    } else core[name] = value;
  }
  if (Object.keys(core).length) config.push({ name: "meeko/rules", files, rules: core });
  if (Object.keys(tsRules).length) config.push({ name: "meeko/typescript-rules", files: typedFiles, rules: tsRules });
  if (Object.keys(meekoRules).length) config.push({ name: "meeko/template-rules", files: meekoFiles, rules: meekoRules });
  if (Object.keys(optionalRules).length) config.push({ name: "meeko/optional-rules", files, rules: optionalRules });
  return [...config, ...overrides];
}
