/**
 * Meeko's own template tags (`<MeekoLink>`, `<MeekoOutlet />`…) as the editor sees them: their props,
 * their content, their documentation and where they are valid. One entry per tag; the virtual code,
 * the hover, "go to definition" and the completion read this table, so a new built-in tag only adds
 * an entry here, its props type in `@meekojs/meeko/framework` and that type's name in
 * `builtinTagTypes` of `autoimports.ts`, which autoimports it.
 */
import { readThemeEnabledSync } from "../framework/config.js";

/** A prop of a built-in tag, as the template writes it. */
export interface BuiltinTagProp {
  /** Name of the prop in the props type, such as `params`. */
  readonly name: string;
  /** Attributes that set it, the preferred one first: `bind:params`; `to` also admits `bind:to`. */
  readonly attributes: readonly string[];
  /** Type shown when the package does not declare {@link BuiltinTag.propsType}. */
  readonly type: string;
  readonly optional: boolean;
  /** Markdown, used when the package does not declare the props type. */
  readonly documentation: string;
  /** Completion snippet of the attribute, such as `bind:params="{ $1 }"`. */
  readonly insert: string;
  /** Short text of the completion item. */
  readonly detail: string;
  /** After inserting it, ask for completion again (the routes of `to="…"`). */
  readonly suggest?: boolean;
}

/** A snippet a built-in tag renders: `default` is its content. */
export interface BuiltinTagSnippet {
  readonly name: string;
  readonly parameters: string;
  readonly optional: boolean;
  readonly documentation: string;
}

/** A tag of Meeko's own that the compiler turns into an element or a component. */
export interface BuiltinTag {
  readonly name: string;
  /**
   * Interface of `@meekojs/meeko/framework` that declares the props. The hover reads its members
   * and their JSDoc, and "go to definition" opens it. An older package without it falls back to
   * {@link props}.
   */
  readonly propsType: string;
  /**
   * Type parameters of {@link propsType} and of the check of each tag, from its static attributes:
   * `<MeekoLink to="/users/[id]">` checks `MeekoLinkProps<"/users/[id]">`.
   */
  readonly typeArguments?: (attributes: ReadonlyMap<string, string>) => string | undefined;
  /**
   * Generic parameters of the virtual check `declare function __meeko_builtin_X<…>(props: …)`,
   * whose argument then infers them from the tag's props; `props` is its parameter type.
   */
  readonly check?: { readonly parameters: string; readonly props: string };
  readonly props: readonly BuiltinTagProp[];
  readonly snippets: readonly BuiltinTagSnippet[];
  /**
   * HTML element it renders: every other attribute, its `on:` events (typed as that element's) and
   * its content go to it. Without one the tag admits no other attributes.
   */
  readonly element?: string;
  /** Attributes the tag rejects, such as `href` on `<MeekoLink>`; the completion leaves them out. */
  readonly rejected?: readonly string[];
  /** One paragraph of Markdown for the hover. */
  readonly summary: string;
  /** Guide of the tag. */
  readonly guide: string;
  /** Detail of the `<` completion item. */
  readonly completion: string;
  /** Components where the tag is valid; any component if omitted. */
  readonly allowedIn?: (filename: string) => boolean;
  /**
   * Whether the project has the tag, from its root (`<MeekoThemeToggle>` needs `theme` in
   * `meeko.config.ts`); always if omitted. The `<` completion leaves it out otherwise.
   */
  readonly enabled?: (projectRoot: string) => boolean;
  /**
   * The tag is a component that Meeko compiles and ships (`<MeekoThemeToggle>`): the virtual code
   * checks it as a component tag, so its props, snippets and directives are typed like any other;
   * the table gives its completion, hover and definition.
   */
  readonly component?: boolean;
  /**
   * Type of `@meekojs/meeko/framework` whose keys are the tag's snippets when they depend on the
   * application (one per theme of `meeko.config.ts`). The hover lists them; without its keys (no
   * generated declarations, an older package) it shows {@link snippets}.
   */
  readonly snippetsType?: string;
}

const guide = "https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekooutlet--y-meekolink";
const themeGuide = "https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekothemetoggle";
const framework = "import(\"@meekojs/meeko/framework\")";

/** `app/app.meeko`, a layout of `app/layouts` or a `+layout.meeko`: where `<MeekoOutlet />` is valid. */
export function isOutletHost(filename: string): boolean {
  return /[\\/]app[\\/]app\.meeko$|[\\/]app[\\/]layouts[\\/].+\.meeko$|[\\/]\+layout\.meeko$/.test(filename);
}

/** Meeko's own tags, in the order the completion offers them. */
export const builtinTags: readonly BuiltinTag[] = [
  {
    name: "MeekoLink",
    propsType: "MeekoLinkProps",
    typeArguments: (attributes) => {
      const to = attributes.get("to");
      return to === undefined ? undefined : `<${JSON.stringify(to)}>`;
    },
    check: {
      parameters: `<K extends ${framework}.MeekoLinkProps["to"]>`,
      props: `${framework}.MeekoLinkProps<K>`,
    },
    props: [
      {
        name: "to", attributes: ["to", "bind:to"], type: "string", optional: false,
        documentation: "ID de la ruta de destino, como `to=\"/users/[id]\"`: sólo las rutas que existen.",
        insert: "to=\"$1\"", detail: "Ruta de la página, como /users/[id]: sólo las que existen", suggest: true,
      },
      {
        name: "params", attributes: ["bind:params"], type: "Record<string, string>", optional: true,
        documentation: "Parámetros de una ruta dinámica, como `bind:params=\"{ id: user.id }\"`; obligatorios en las rutas dinámicas.",
        insert: "bind:params=\"{ $1 }\"", detail: "Parámetros de una ruta dinámica, como { id: user.id }",
      },
      {
        name: "search", attributes: ["bind:search"], type: "Readonly<Record<string, string | number | boolean | null | undefined>>", optional: true,
        documentation: "Query string, como `bind:search=\"{ tab: 'perfil' }\"`. Omite `null` y `undefined`.",
        insert: "bind:search=\"{ $1 }\"", detail: "Query string, como { tab: \"perfil\" }",
      },
    ],
    snippets: [{ name: "default", parameters: "", optional: true, documentation: "El contenido del enlace, dentro del `<a>`." }],
    element: "a",
    rejected: ["href", "bind:href", "params", "search"],
    summary: "Enlace a una página de la aplicación: renderiza un `<a>` cuyo `href` construye `href()` con `to`, `bind:params` y `bind:search`, "
      + "y añade `aria-current=\"page\"` en la ruta activa. El resto de atributos (`class`, `target`, `aria-*`, `on:click`…) y el contenido pasan al `<a>`.",
    guide,
    completion: "Enlace a una ruta tipada: <MeekoLink to=\"/users/[id]\" bind:params=\"{ id }\">",
  },
  {
    name: "MeekoOutlet",
    propsType: "MeekoOutletProps",
    props: [],
    snippets: [],
    summary: "Pinta el layout o la página que van dentro, a partir de la prop `outlet` que Meeko pasa. Sólo en `app/app.meeko` y en los layouts, "
      + "sin atributos ni contenido (`MEEK104`).",
    guide,
    completion: "La página o el layout de dentro: <MeekoOutlet />",
    allowedIn: isOutletHost,
  },
  {
    name: "MeekoThemeToggle",
    propsType: "MeekoThemeToggleProps",
    props: [
      {
        name: "mode", attributes: ["mode", "bind:mode"], type: "\"cycle\" | \"select\"", optional: true,
        documentation: "`\"cycle\"` (por defecto), un botón que pasa a la elección siguiente; `\"select\"`, un grupo de radios.",
        insert: "mode=\"${1|cycle,select|}\"", detail: "\"cycle\" (por defecto), un botón que pasa al tema siguiente, o \"select\", un grupo de radios",
      },
      {
        name: "themes", attributes: ["bind:themes"], type: "readonly string[]", optional: true,
        documentation: "Elecciones y su orden, como `bind:themes=\"['light', 'dark']\"`; por defecto, los temas de la configuración y `\"system\"` si está activo.",
        insert: "bind:themes=\"[$1]\"", detail: "Elecciones y su orden, como ['light', 'dark']",
      },
      {
        name: "labels", attributes: ["bind:labels"], type: "Partial<Record<string, string>>", optional: true,
        documentation: "Nombre de cada elección, como `bind:labels=\"{ dark: 'Oscuro' }\"`; por defecto, «Claro», «Oscuro», «Sistema» y el nombre de los demás temas.",
        insert: "bind:labels=\"{ $1 }\"", detail: "Nombre de cada elección, como { dark: 'Oscuro' }",
      },
      {
        name: "messages", attributes: ["bind:messages"], type: "ThemeToggleMessages", optional: true,
        documentation: "Textos accesibles del botón y del grupo (`cycle(current, next)`, `unknown` y `group`), para traducirlos.",
        insert: "bind:messages=\"{ $1 }\"", detail: "Textos accesibles: cycle(current, next), unknown y group",
      },
      {
        name: "class", attributes: ["class", "bind:class"], type: "string", optional: true,
        documentation: "Clases del elemento raíz, el `<form>`.",
        insert: "class=\"$1\"", detail: "Clases del <form> raíz",
      },
      {
        name: "id", attributes: ["id", "bind:id"], type: "string", optional: true,
        documentation: "`id` del elemento raíz, el `<form>`.",
        insert: "id=\"$1\"", detail: "id del <form> raíz",
      },
    ],
    // Without the generated declarations of the themes: the choices of `theme: true`.
    snippets: ["light", "dark", "system"].map((name) => ({ name, parameters: "", optional: true, documentation: `Icono de la elección \`${name}\`; sin él se pinta su nombre.` })),
    snippetsType: "ThemeToggleSnippets",
    component: true,
    summary: "Selector de tema claro/oscuro de `theme` en `meeko.config.ts`, un componente que Meeko compila y distribuye: un `<form method=\"post\" action=\"/_meeko/theme\">` "
      + "que funciona sin JavaScript. Pinta un icono por elección, el snippet con su nombre, y la regla que Meeko añade a `<head>` muestra el de `data-theme-choice` de `<html>`, "
      + "así que nunca salta. `mode=\"cycle\"` es un botón que pasa al tema siguiente y `mode=\"select\"`, un grupo de radios. Sin `theme` es el error `MEEK111`.",
    guide: themeGuide,
    completion: "Cambia el tema claro/oscuro sin parpadeo: <MeekoThemeToggle mode=\"cycle\">",
    enabled: (projectRoot) => readThemeEnabledSync(projectRoot) !== false,
  },
];

const byName = new Map(builtinTags.map((tag) => [tag.name, tag]));

/** The built-in tag with this name, if there is one. */
export function builtinTag(name: string): BuiltinTag | undefined {
  return byName.get(name);
}

/** The prop of a built-in tag that an attribute sets (`bind:params` → `params`), if any. */
export function builtinTagProp(tag: BuiltinTag, attribute: string): BuiltinTagProp | undefined {
  return tag.props.find((prop) => prop.attributes.includes(attribute));
}
