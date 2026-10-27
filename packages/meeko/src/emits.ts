import type { ComponentModule } from "./dom.js";

/**
 * Runtime and types behind `defineEmits<T>()`.
 *
 * There is no event channel: each event `save` of `T` becomes the optional callback prop
 * `onSave`, and `emit("save", ...args)` calls that prop. The generated module reaches these
 * names through `@meekojs/meeko/internal`.
 */

/** Constraint of a `defineEmits` type: every event maps to the tuple of its arguments. */
export type EmitMap<Events> = { [K in keyof Events]: readonly unknown[] };

/** Validates a `defineEmits` type argument where it is written. */
export type Emits<Events extends EmitMap<Events>> = Events;

/**
 * Argument tuple of an event. The other types do not repeat the `EmitMap` constraint, so an
 * invalid event map is reported once, on the `defineEmits` type argument.
 */
export type EmitArgs<Args> = Args extends readonly unknown[] ? Args : never;

/** Optional callback props that a parent sets with `on:event` or `bind:onEvent`. */
export type EmitProps<Events> = {
  [K in keyof Events & string as `on${Capitalize<K>}`]?: ((...args: EmitArgs<Events[K]>) => void) | undefined;
};

/** Function returned by `defineEmits`; it calls the parent callback if there is one. */
export type Emit<Events> = <K extends keyof Events & string>(name: K, ...args: EmitArgs<Events[K]>) => void;

/** Callback props of `defineEmits` that `defineProps` also declares. */
export type EmitConflicts<Props, Events> = Props extends unknown ? Extract<keyof Props, keyof EmitProps<Events>> : never;

/** `true` without conflicts; otherwise a message that names the duplicated props. */
export type NoEmitConflict<Props, Events> = [EmitConflicts<Props, Events>] extends [never]
  ? true
  : `defineEmits events conflict with defineProps props: ${EmitConflicts<Props, Events> & string}`;

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
export function createEmit<Events, Check extends true = true>(props: object): Emit<Events> {
  const emit = (name: string, ...args: readonly unknown[]): unknown => {
    const handler: unknown = Reflect.get(props, emitPropName(name));
    if (handler === undefined || handler === null) return undefined;
    if (typeof handler !== "function") throw new TypeError(`Meeko emit "${name}" expected the ${emitPropName(name)} prop to be a function`);
    return handler(...args);
  };
  return emit as Emit<Events>;
}
