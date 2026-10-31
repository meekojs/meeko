import type { ComponentWithProps } from "../runtime/resolved-component";

/**
 * Project component modules registered by Meeko. The generated declaration augments this interface.
 * @example
 * ```ts
 * type Names = keyof ComponentRegistry;
 * ```
 */
export interface ComponentRegistry {}

/**
 * Names of the components discovered for the current project.
 * @example
 * ```ts
 * const name: ComponentName = "Button";
 * ```
 */
export type ComponentName = Extract<keyof ComponentRegistry, string>;

/**
 * The original renderable module for a registered component, including its public exports.
 * @example
 * ```ts
 * type ButtonModule = ComponentOf<"Button">;
 * ```
 */
export type ComponentOf<Name extends ComponentName> = ComponentRegistry[Name];

/**
 * Input props of the module's actual `renderToString` contract.
 * @example
 * ```ts
 * type ButtonInput = ComponentProps<"Button">;
 * ```
 */
export type ComponentProps<Name extends ComponentName> = ComponentOf<Name> extends {
  renderToString: (props: infer Props, ...args: never[]) => string;
} ? Props : never;

/**
 * A registered component with its props already supplied to `resolveComponent(name, props)`.
 * Render it directly with `<component is>`; explicit template props override the bound values.
 * @example
 * ```ts
 * const form = signal<ResolvedComponent<"FormUserCreate"> | undefined>(undefined);
 * ```
 */
export type ResolvedComponent<Name extends ComponentName = ComponentName> = Name extends ComponentName
  ? ComponentWithProps<ComponentOf<Name>> : never;

/**
 * Correlated name and props pairs for dynamic APIs. Use a rest parameter of this type when the
 * name may be a union; a plain generic pair can infer the union and accept unrelated props.
 * @example
 * ```ts
 * function openModal(...[name, props]: ComponentArgs): void {
 *   // Render the component named by `name` with `props`.
 * }
 * ```
 */
export type ComponentArgs = {
  [Name in ComponentName]: [name: Name, props: ComponentProps<Name>];
}[ComponentName];
