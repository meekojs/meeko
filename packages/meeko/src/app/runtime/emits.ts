import type { ComponentModule } from "./renderer";

/**
 * Runtime and types behind `defineEmits<T>()`.
 *
 * There is no event channel: each event `save` of `T` becomes the optional callback prop
 * `onSave`, and `emit("save", ...args)` calls that prop. The generated module reaches these
 * names through `@meekojs/meeko/internal`.
 */

export type { Emit, EmitArgs, EmitConflicts, EmitMap, EmitProps, Emits, NoEmitConflict } from "../definitions/define-emits";
import type { Emit } from "../definitions/define-emits";

/**
 * Type-only check of the `on:event` props of a child component; generated code never calls it.
 * `Props` comes from the component alone, so an event the child does not declare is an excess
 * property and the handler is typed by the callback prop.
 */
export function checkComponentEvents<Props extends object>(component: ComponentModule<Props>, events: NoInfer<Partial<Props>>): void {
  void component;
  void events;
}

/** Prop name of an event: `save` becomes `onSave`. */
export function emitPropName(name: string): string {
  return `on${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Creates the `emit` of a component instance. The prop is read on each call, so the callback
 * that the parent currently passes is the one that runs. The callback result is returned at
 * runtime so a DOM handler such as `() => emit("save")` reports an async rejection as usual.
 */
export function createEmit<Events, _Check extends true = true>(props: object): Emit<Events> {
  const emit = (name: string, ...args: readonly unknown[]): unknown => {
    const handler: unknown = Reflect.get(props, emitPropName(name));
    if (handler === undefined || handler === null) return undefined;
    if (typeof handler !== "function") throw new TypeError(`Meeko emit "${name}" expected the ${emitPropName(name)} prop to be a function`);
    return handler(...args);
  };
  return emit as Emit<Events>;
}
