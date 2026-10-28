/**
 * Plugin de PostCSS de Meeko: `@utilities "<ruta>" [layer(<nombre>)];` genera reglas CSS con
 * una función de TypeScript. Sólo se ejecuta en Node, durante `meeko dev` y el build; nunca
 * forma parte del runtime del navegador ni del servidor.
 *
 * ```ts
 * // postcss.config.ts
 * import { meekoUtilities } from "@meekojs/meeko/postcss";
 * export default { plugins: [meekoUtilities()] };
 * ```
 */
export { defineUtilities, meekoUtilities, meekoUtilities as default } from "./postcss/utilities.js";
export type {
  MeekoUtilitiesOptions,
  UtilityAtRule,
  UtilityAtRuleDeclarations,
  UtilityCss,
  UtilityDeclarations,
  UtilityFunction,
  UtilityHelpers,
  UtilityNode,
  UtilityOutput,
  UtilityRule,
  UtilityValue,
} from "./postcss/utilities.js";
