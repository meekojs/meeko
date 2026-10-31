import type { GeneratedLayouts, GeneratedPageLayouts, GeneratedRouteMiddleware } from "../framework";

type RouteMiddlewareName = keyof GeneratedRouteMiddleware extends never ? string : Exclude<keyof GeneratedRouteMiddleware, "#none"> & string;

/**
 * Nombre de un layout con nombre de la aplicación (`app/layouts/<nombre>.meeko`, los de los layers y
 * los de `meeko.addLayout`): la unión que declara `.meeko/types/routes.d.ts` (`meeko check`,
 * `meeko dev`), o `string` sin esas declaraciones.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import type { LayoutName } from "@meekojs/meeko/framework";
 *
 * const layout: LayoutName = "dashboard";
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#layouts-con-nombre
 */
export type LayoutName = keyof GeneratedLayouts extends never ? string : keyof GeneratedLayouts & string;

type OwnProps<P> = P extends object ? { [K in keyof P as K extends "outlet" ? never : K]: P[K] } : Record<string, unknown>;

/**
 * Props que una página puede pasar al layout `L`: las `Props` que declara el layout, sin `outlet`.
 * Con `false` (página sin layout con nombre) no hay ninguna; sin las declaraciones generadas, es
 * `Record<string, unknown>`.
 *
 * @typeParam L Nombre del layout, o `false`.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { LayoutProps } from "@meekojs/meeko/framework";
 *
 * // Con app/layouts/dashboard.meeko declarando { title?: string; showAlert?: boolean }:
 * const props: LayoutProps<"dashboard"> = { title: "Conexiones", showAlert: true };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#props-del-layout-desde-la-página
 */
export type LayoutProps<L extends string | false = LayoutName> = [L] extends [false] ? Record<string, never>
  : L extends keyof GeneratedLayouts ? OwnProps<GeneratedLayouts[L]> : Record<string, unknown>;

/**
 * Layout con nombre de la página cuyo ID de ruta es `Id`, tal como lo resuelven su `definePage` y
 * los `+group.ts` de sus carpetas: un nombre, `false` sin layout con nombre o, sin las declaraciones
 * generadas, {@link LayoutName}. Tipa `useLayout()` en el `<script>` de cada página.
 *
 * @typeParam Id ID de la ruta, como `"/dashboard"`.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { PageLayout } from "@meekojs/meeko/framework";
 *
 * type DashboardLayout = PageLayout<"/dashboard">; // "dashboard"
 * ```
 */
export type PageLayout<Id extends string> = Id extends keyof GeneratedPageLayouts ? GeneratedPageLayouts[Id] : LayoutName;

/**
 * Lo que devuelve {@link useLayout}: las props del layout con nombre de la página, para leerlas y
 * cambiarlas desde el `<script>` de la página.
 *
 * @typeParam P Props del layout, sin `outlet`.
 * @since 1.5.0
 * @example
 * ```html
 * <script lang="ts">
 * const layout = useLayout();
 * const title = signal("Conexiones");
 * effect(() => layout.set({ title: title.value }));
 * </script>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#props-del-layout-desde-la-página
 */
export interface LayoutHandle<P extends object = Record<string, unknown>> {
  /** Nombre del layout con nombre de la página, o `undefined` si no tiene (`layout: false`). */
  readonly name: string | undefined;
  /**
   * Las props que recibe ahora el layout (sin `outlet`): las de `layoutProps` y los `+group.ts` con
   * lo que haya escrito la página encima. La lectura es reactiva.
   */
  readonly props: Readonly<Partial<P>>;
  /**
   * Cambia props del layout; las que no nombra se conservan. El layout no se vuelve a montar: sólo
   * cambia lo que lee esas props. Al navegar a otra página, el layout recibe las de la página nueva.
   * Sin layout con nombre, no hace nada.
   */
  set<const Q extends Partial<P>>(patch: Q & { readonly [K in Exclude<keyof Q, keyof P>]: never }): void;
}

/**
 * Valor de `layoutProps`: las props del layout `L` o, en las opciones de ruta, una función que las
 * calcula con el contexto de la página (`data` incluido), como `head`. Viajan en el payload, así que
 * deben poder serializarse en JSON.
 *
 * @typeParam L Layout de la página.
 * @typeParam C Contexto de la función.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { LayoutPropsInput } from "@meekojs/meeko/framework";
 *
 * const input: LayoutPropsInput<"dashboard", { data: { name: string } }> = ({ data }) => ({ title: data.name });
 * ```
 */
export type LayoutPropsInput<L extends string | false, C> = Partial<LayoutProps<L>> | ((context: C) => Partial<LayoutProps<L>>);

/**
 * Opciones de layout de las opciones de ruta (`definePage`): `layout` elige el layout con nombre y
 * `layoutProps` le pasa props, tipadas contra ese layout. Sin `layout`, la página hereda el de sus
 * `+group.ts` o `default`; entonces `meeko check` comprueba `layoutProps` contra el heredado.
 *
 * @typeParam C Contexto de la función de `layoutProps`.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { PageLayoutOptions } from "@meekojs/meeko/framework";
 *
 * const options: PageLayoutOptions<unknown> = { layout: "dashboard", layoutProps: { title: "Panel" } };
 * ```
 */
export type PageLayoutOptions<C> =
  | {
    /** Sin `layout`, el de los `+group.ts` de la página o `default`. */
    readonly layout?: undefined;
    /** Props para el layout heredado; `meeko check` las compara con las suyas. */
    readonly layoutProps?: LayoutPropsInput<LayoutName, C>;
  }
  | {
    /** Sin layout con nombre: quedan `app/app.meeko` y los `+layout.meeko`. */
    readonly layout: false;
    /** Sin layout con nombre no hay props que pasar. */
    readonly layoutProps?: never;
  }
  | { [L in LayoutName]: {
    /** Layout con nombre de la página. */
    readonly layout: L;
    /** Props del layout `L`: un objeto o una función del contexto de la página. */
    readonly layoutProps?: LayoutPropsInput<L, C>;
  } }[LayoutName];

/**
 * Opciones de un `+group.ts`, que heredan las páginas de su carpeta y de sus subcarpetas. Meeko las
 * lee sin ejecutar el archivo: `layout` es un literal y `layoutProps` un objeto literal.
 *
 * @typeParam L Layout del grupo.
 * @since 1.5.0
 * @example
 * ```ts
 * import type { GroupDefinition } from "@meekojs/meeko/framework";
 *
 * const group: GroupDefinition<"dashboard"> = { layout: "dashboard", layoutProps: { showAlert: false } };
 * ```
 */
export interface GroupDefinition<L extends LayoutName | false = LayoutName> {
  /** Layout con nombre de las páginas del grupo, o `false` para quitarlo. Una página puede elegir otro. */
  readonly layout?: L;
  /**
   * Props del layout para las páginas del grupo. Se combinan por clave con las de los grupos
   * exteriores y con las de la página, que gana. Un grupo o una página que elige otro layout empieza
   * sin las props heredadas.
   */
  readonly layoutProps?: Partial<LayoutProps<L>>;
  /**
   * Middleware con nombre de `app/middleware` para las páginas del grupo, que se ejecutan después de
   * los globales y de los de los grupos exteriores, o `false` para quitar los heredados. Una página
   * puede añadir los suyos.
   * @since 1.6.0
   */
  readonly middleware?: readonly RouteMiddlewareName[] | false;
}



