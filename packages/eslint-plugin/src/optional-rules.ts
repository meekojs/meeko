import type { Linter } from "eslint";
import type * as Perfectionist from "eslint-plugin-perfectionist";
import type { TypeScriptRules } from "./typescript-rules.generated.js";

/** Perfectionist publishes precise options on its public entry; keep them linked to that API. */
export interface PerfectionistRules {
  "perfectionist/sort-array-includes": Linter.RuleEntry<Perfectionist.SortArrayIncludesOptions>;
  "perfectionist/sort-arrays": Linter.RuleEntry<Perfectionist.SortArraysOptions>;
  "perfectionist/sort-classes": Linter.RuleEntry<Perfectionist.SortClassesOptions>;
  "perfectionist/sort-constructor-parameters": Linter.RuleEntry<Perfectionist.SortConstructorParametersOptions>;
  "perfectionist/sort-decorators": Linter.RuleEntry<Perfectionist.SortDecoratorsOptions>;
  "perfectionist/sort-enums": Linter.RuleEntry<Perfectionist.SortEnumsOptions>;
  "perfectionist/sort-export-attributes": Linter.RuleEntry<Perfectionist.SortExportAttributesOptions>;
  "perfectionist/sort-exports": Linter.RuleEntry<Perfectionist.SortExportsOptions>;
  "perfectionist/sort-heritage-clauses": Linter.RuleEntry<Perfectionist.SortHeritageClausesOptions>;
  "perfectionist/sort-import-attributes": Linter.RuleEntry<Perfectionist.SortImportAttributesOptions>;
  "perfectionist/sort-imports": Linter.RuleEntry<Perfectionist.SortImportsOptions>;
  "perfectionist/sort-interfaces": Linter.RuleEntry<Perfectionist.SortInterfacesOptions>;
  "perfectionist/sort-intersection-types": Linter.RuleEntry<Perfectionist.SortIntersectionTypesOptions>;
  "perfectionist/sort-jsx-props": Linter.RuleEntry<Perfectionist.SortJsxPropsOptions>;
  "perfectionist/sort-maps": Linter.RuleEntry<Perfectionist.SortMapsOptions>;
  "perfectionist/sort-modules": Linter.RuleEntry<Perfectionist.SortModulesOptions>;
  "perfectionist/sort-named-exports": Linter.RuleEntry<Perfectionist.SortNamedExportsOptions>;
  "perfectionist/sort-named-imports": Linter.RuleEntry<Perfectionist.SortNamedImportsOptions>;
  "perfectionist/sort-object-types": Linter.RuleEntry<Perfectionist.SortObjectTypesOptions>;
  "perfectionist/sort-objects": Linter.RuleEntry<Perfectionist.SortObjectsOptions>;
  "perfectionist/sort-sets": Linter.RuleEntry<Perfectionist.SortSetsOptions>;
  "perfectionist/sort-switch-case": Linter.RuleEntry<Perfectionist.SortSwitchCaseOptions>;
  "perfectionist/sort-union-types": Linter.RuleEntry<Perfectionist.SortUnionTypesOptions>;
  "perfectionist/sort-variable-declarations": Linter.RuleEntry<Perfectionist.SortVariableDeclarationsOptions>;
}

/** Both public schemas equal the pinned TS no-unused-vars schema; tests guard that contract. */
export interface UnusedImportsRules {
  "unused-imports/no-unused-imports": TypeScriptRules["@typescript-eslint/no-unused-vars"];
  "unused-imports/no-unused-vars": TypeScriptRules["@typescript-eslint/no-unused-vars"];
}
