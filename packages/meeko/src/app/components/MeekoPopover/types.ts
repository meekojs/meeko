/** Lado del disparador en el que se abre el contenido. */
export type PopoverSide = "top" | "bottom" | "left" | "right";

/**
 * Posición del contenido respecto al disparador: un lado y, opcionalmente, la alineación con su
 * borde inicial (`-start`) o final (`-end`). `"bottom-start"` abre debajo, alineado a la izquierda.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover placement="right-start"><snippet name="trigger">Más</snippet>…</MeekoPopover>
 * ```
 */
export type PopoverPlacement = PopoverSide | `${PopoverSide}-start` | `${PopoverSide}-end`;

/**
 * Comportamiento del contenido, el valor de su atributo `popover`: `"auto"` se cierra al pulsar
 * fuera y con `Esc`; `"manual"` sólo se cierra desde el disparador, `Esc` o el modelo; `"hint"` es
 * un tooltip que se abre al pasar el puntero o al enfocar el disparador, sin robar el foco.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover mode="hint"><snippet name="trigger">?</snippet>Ayuda contextual</MeekoPopover>
 * ```
 */
export type PopoverMode = "auto" | "manual" | "hint";

/**
 * Patrón ARIA del contenido: `"menu"` (con `menuitem`, flechas y búsqueda por letras),
 * `"dialog"` (el foco entra en el contenido) o `"tooltip"` (por defecto con `mode="hint"`).
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover role="dialog" label="Filtros"><snippet name="trigger">Filtrar</snippet>…</MeekoPopover>
 * ```
 */
export type PopoverRole = "menu" | "dialog" | "tooltip";

/**
 * Atributos del disparador propio de `<MeekoPopover>`, el parámetro `trigger` del snippet `anchor`.
 * Cada clave es el nombre del atributo, así que el objeto sirve tal cual para `bind="trigger"`, en un
 * elemento o en un componente propio como `<AppButton bind="trigger">` que declare esas props y las
 * ponga en su botón. `<MeekoPopover>` encuentra el elemento por su `id` al montarse y le añade el
 * teclado y el anclaje.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover role="menu">
 *   <snippet name="anchor" params="trigger">
 *     <button type="button" class="avatar" bind="trigger"><img src="/me.png" alt="Mi cuenta"></button>
 *   </snippet>
 *   <button role="menuitem">Perfil</button>
 * </MeekoPopover>
 * ```
 */
export interface PopoverTrigger {
  /** `id` del disparador: `<MeekoPopover>` lo busca con él para anclar el contenido. */
  readonly id: string;
  /** `popovertarget` para un `<button>`: abre y cierra el contenido sin JavaScript. Sin valor con `mode="hint"`. */
  readonly popovertarget: string | undefined;
  /** `aria-controls`: el `id` del contenido. Sin valor con `mode="hint"`. */
  readonly "aria-controls": string | undefined;
  /** `aria-expanded`: `"true"` mientras el contenido está abierto. Sin valor con `mode="hint"`. */
  readonly "aria-expanded": "true" | "false" | undefined;
  /** `aria-haspopup` según `role`: `"menu"` o `"dialog"`. */
  readonly "aria-haspopup": "menu" | "dialog" | undefined;
  /** `aria-describedby` de un tooltip (`mode="hint"`): el `id` del contenido. */
  readonly "aria-describedby": string | undefined;
}

/**
 * Detalle del evento `toggle` de `<MeekoPopover>`, que se emite cada vez que el contenido se abre
 * o se cierra, por el usuario o por el modelo.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover on:toggle="(event) => opened.value = event.open">…</MeekoPopover>
 * ```
 */
export interface PopoverToggleEvent {
  /** `true` si el contenido acaba de abrirse. */
  readonly open: boolean;
}

/**
 * Snippets de `<MeekoPopover>`: el contenido suelto (`default`) va dentro del elemento con
 * `popover`; `trigger` es el contenido del `<button>` disparador que pinta Meeko, y `anchor`
 * sustituye ese botón por un disparador propio, con sus atributos en el parámetro.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover><snippet name="trigger">Opciones ▾</snippet><p>Contenido</p></MeekoPopover>
 * ```
 */
export interface PopoverSnippets {
  /** El contenido del popover. */
  default?: [];
  /** El contenido del `<button>` disparador que pinta Meeko. */
  trigger?: [];
  /** Un disparador propio, en lugar del botón: recibe sus atributos en {@link PopoverTrigger}. */
  anchor?: [trigger: PopoverTrigger];
}

/**
 * Props de la etiqueta propia `<MeekoPopover>`: un contenido en la capa superior (`popover`),
 * anclado a su disparador con *CSS anchor positioning* y con un cálculo en JavaScript donde el
 * navegador no lo tiene. El modelo por defecto (`model="open"`) es la señal de apertura. Se
 * autoimporta en `app/` como el resto de tipos de las etiquetas.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoPopover placement="bottom-start" bind:offset="8" model="open" role="menu">
 *   <snippet name="trigger">Opciones ▾</snippet>
 *   <button role="menuitem" on:click="rename">Renombrar</button>
 *   <button role="menuitem" on:click="remove">Eliminar</button>
 * </MeekoPopover>
 * ```
 */
export interface MeekoPopoverProps {
  /** `"auto"` (por defecto), `"manual"` o `"hint"`; véase {@link PopoverMode}. */
  readonly mode?: PopoverMode;
  /** Dónde se abre respecto al disparador; `"bottom-start"` por defecto. */
  readonly placement?: PopoverPlacement;
  /** Separación en píxeles entre el disparador y el contenido; `0` por defecto. */
  readonly offset?: number;
  /** Patrón ARIA del contenido; con `mode="hint"`, `"tooltip"` por defecto. */
  readonly role?: PopoverRole;
  /** `aria-label` del contenido. Sin ella, un menú o un diálogo se nombran con el disparador. */
  readonly label?: string;
  /** Clases del contenido, el elemento con `popover`. */
  readonly class?: string;
  /** Clases del `<button>` disparador que pinta Meeko. */
  readonly triggerClass?: string;
  /** `id` del disparador; por defecto, uno de `useId`. Con un disparador propio, el `id` que lleva. */
  readonly triggerId?: string;
  /** Con `true`, el contenido mide al menos lo que el disparador (`anchor-size(width)`). */
  readonly matchWidth?: boolean;
  /** Con `mode="hint"`, milisegundos que el puntero espera sobre el disparador antes de abrir; `300` por defecto. */
  readonly delay?: number;
  /** Con `mode="hint"`, milisegundos antes de cerrar al salir el puntero; `150` por defecto. */
  readonly closeDelay?: number;
}

/**
 * Lo que `<MeekoPopover>` expone a una `ref:` del padre: abrir, cerrar y alternar desde código.
 * @since 1.5.0
 * @example
 * ```ts
 * const menu = useElementRef("menu");
 * function openMenu(): void { menu.value?.show(); }
 * ```
 */
export interface PopoverExposed {
  /** Abre el contenido. */
  show(): void;
  /** Cierra el contenido. */
  hide(): void;
  /** Abre el contenido si está cerrado y lo cierra si está abierto. */
  toggle(): void;
}

