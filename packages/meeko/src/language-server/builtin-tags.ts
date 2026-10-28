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
   * Module of a {@link component} tag that ships on its own (`@meekojs/meeko/builtins/popover`):
   * the virtual code declares the tag as that module, which the compiled component imports only
   * when it uses the tag. Every component tag has one; the compiler reads the same specifiers from
   * `builtinComponentModules`.
   */
  readonly module?: string;
  /**
   * Type of `@meekojs/meeko/framework` whose keys are the tag's snippets when they depend on the
   * application (one per theme of `meeko.config.ts`). The hover lists them; without its keys (no
   * generated declarations, an older package) it shows {@link snippets}.
   */
  readonly snippetsType?: string;
}

const guide = "https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekooutlet--y-meekolink";
const themeGuide = "https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekothemetoggle";
const popoverGuide = "https://github.com/meekojs/meeko/blob/main/docs/api.md#popover-meekopopover";
const selectGuide = "https://github.com/meekojs/meeko/blob/main/docs/api.md#select-meekoselect";

/** The placements of `<MeekoPopover>` and `<MeekoSelect>`, for the completion of `placement`. */
const placements = "top,top-start,top-end,bottom,bottom-start,bottom-end,left,left-start,left-end,right,right-start,right-end";

/** A prop of the table, for the props that `<MeekoPopover>` and `<MeekoSelect>` share. */
function prop(name: string, type: string, documentation: string, detail: string, options: { attributes?: readonly string[]; insert?: string; optional?: boolean } = {}): BuiltinTagProp {
  return {
    name, type, documentation, detail,
    attributes: options.attributes ?? [`bind:${name}`],
    optional: options.optional ?? true,
    insert: options.insert ?? `${options.attributes?.[0] ?? `bind:${name}`}="$1"`,
  };
}
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
      {
        name: "match", attributes: ["match", "bind:match"], type: "\"exact\" | \"prefix\"", optional: true,
        documentation: "`\"exact\"` (por defecto), activo sólo en su ruta, con `aria-current=\"page\"`; `\"prefix\"`, también en las rutas por debajo "
          + "(`/dashboard` cubre `/dashboard/stats`), con `aria-current=\"true\"`. `to=\"/\"` sólo coincide exacta.",
        insert: "match=\"${1|exact,prefix|}\"", detail: "\"exact\" (por defecto), sólo su ruta, o \"prefix\", también las rutas por debajo",
      },
    ],
    snippets: [{ name: "default", parameters: "", optional: true, documentation: "El contenido del enlace, dentro del `<a>`." }],
    element: "a",
    rejected: ["href", "bind:href", "params", "search"],
    summary: "Enlace a una página de la aplicación: renderiza un `<a>` cuyo `href` construye `href()` con `to`, `bind:params` y `bind:search`, "
      + "y añade `aria-current=\"page\"` en la ruta activa; con `match=\"prefix\"`, también `aria-current=\"true\"` en las rutas por debajo. El resto de atributos (`class`, `target`, `aria-*`, `on:click`…) y el contenido pasan al `<a>`.",
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
    module: "@meekojs/meeko/builtins/theme-toggle",
    summary: "Selector de tema claro/oscuro de `theme` en `meeko.config.ts`, un componente que Meeko compila y distribuye: un `<form method=\"post\" action=\"/_meeko/theme\">` "
      + "que funciona sin JavaScript. Pinta un icono por elección, el snippet con su nombre, y la regla que Meeko añade a `<head>` muestra el de `data-theme-choice` de `<html>`, "
      + "así que nunca salta. `mode=\"cycle\"` es un botón que pasa al tema siguiente y `mode=\"select\"`, un grupo de radios. Sin `theme` es el error `MEEK111`.",
    guide: themeGuide,
    completion: "Cambia el tema claro/oscuro sin parpadeo: <MeekoThemeToggle mode=\"cycle\">",
    enabled: (projectRoot) => readThemeEnabledSync(projectRoot) !== false,
  },
  {
    name: "MeekoAwait",
    propsType: "MeekoAwaitProps",
    props: [
      {
        name: "for", attributes: ["for", "bind:for"], type: "AwaitResource | readonly AwaitResource[]", optional: false,
        documentation: "Recurso que espera, como expresión: el resultado de `useApi` o `useRpcQuery` sin `await` (`for=\"items\"`) o una lista (`for=\"[items, stats]\"`). "
          + "Dentro del contenido, `items.data.value` ya no es `null`.",
        insert: "for=\"$1\"", detail: "Recurso de useApi o useRpcQuery sin await, o una lista: for=\"items\"",
      },
      {
        name: "reserve", attributes: ["reserve", "bind:reserve"], type: "boolean | string", optional: true,
        documentation: "Mientras espera, la zona ocupa la altura que tuvo con datos la última vez (por ruta, petición e instancia, en `sessionStorage`). "
          + "`reserve=\"320px\"` fija además un mínimo, también en la primera visita.",
        insert: "reserve", detail: "Reserva la altura que tuvo con datos; reserve=\"320px\" añade un mínimo",
      },
      {
        name: "messages", attributes: ["bind:messages"], type: "AwaitMessages", optional: true,
        documentation: "Textos del aviso de error por defecto (`error` y `retry`), sin el snippet `error`, para traducirlos.",
        insert: "bind:messages=\"{ $1 }\"", detail: "Textos del aviso de error por defecto: error y retry",
      },
      {
        name: "class", attributes: ["class", "bind:class"], type: "string", optional: true,
        documentation: "Clases del contenedor, un `<div>`.",
        insert: "class=\"$1\"", detail: "Clases del <div> contenedor",
      },
      {
        name: "id", attributes: ["id", "bind:id"], type: "string", optional: true,
        documentation: "`id` del contenedor.",
        insert: "id=\"$1\"", detail: "id del <div> contenedor",
      },
    ],
    snippets: [
      { name: "default", parameters: "refreshing: boolean", optional: false, documentation: "El contenido con datos; `refreshing` es `true` durante una recarga, que lo conserva." },
      { name: "pending", parameters: "", optional: true, documentation: "La primera carga: un esqueleto con la altura del contenido." },
      { name: "error", parameters: "error: Error, retry: () => void", optional: true, documentation: "Un fallo sin datos: `error` y `retry`, que vuelve a pedirlos. Sin él, un aviso con `role=\"alert\"` y un botón." },
    ],
    component: true,
    module: "@meekojs/meeko/builtins/await",
    summary: "Zona de unos datos que llegan después del primer pintado (`useApi` o `useRpcQuery` sin `await`), un componente que Meeko compila y distribuye: "
      + "pinta `pending` en la primera carga, `error` (con `retry`) si falla y su contenido cuando hay datos, que conserva durante las recargas. "
      + "Con `reserve`, mientras espera ocupa la altura que tuvo con datos, así que la card no salta. Marca `aria-busy` mientras carga.",
    guide: "https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekoawait",
    completion: "Datos que llegan después del primer pintado, sin saltos: <MeekoAwait for=\"items\" reserve>",
  },
  {
    name: "MeekoTeleport",
    propsType: "MeekoTeleportProps",
    props: [
      {
        name: "to", attributes: ["to", "bind:to"], type: "MeekoTeleportTarget", optional: false,
        documentation: "Destino: `\"body\"`, al final de `<body>`, o `\"#id\"`, dentro del elemento con ese `id`, después de lo que ya tiene.",
        insert: "to=\"$1\"", detail: "Destino: \"body\" o \"#id\" de un elemento del documento", suggest: true,
      },
      {
        name: "disabled", attributes: ["disabled", "bind:disabled"], type: "boolean", optional: true,
        documentation: "Con `true`, el contenido se pinta en su sitio, sin moverse; cambiarlo mueve los mismos nodos.",
        insert: "disabled", detail: "Pinta el contenido en su sitio, sin moverlo",
      },
    ],
    snippets: [{ name: "default", parameters: "", optional: true, documentation: "El contenido que se pinta en el destino." }],
    summary: "Pinta su contenido en otro lugar del documento (`to=\"body\"` o `to=\"#id\"`) sin sacarlo del componente, que conserva su ámbito reactivo, "
      + "sus eventos, sus snippets, `provide`/`inject`, sus manejadores de errores y el CSS `scoped`. El HTML del servidor ya lo trae en su destino. "
      + "Con `disabled` se pinta en su sitio. Un atributo que no admite es el error `MEEK114`.",
    guide: "https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekoteleport",
    completion: "Contenido en otro lugar del documento: <MeekoTeleport to=\"#toolbar\">",
  },
  {
    name: "MeekoPopover",
    propsType: "MeekoPopoverProps",
    props: [
      prop("mode", "\"auto\" | \"manual\" | \"hint\"", "`\"auto\"` (por defecto) se cierra al pulsar fuera; `\"manual\"`, sólo desde el disparador, `Esc` o el modelo; `\"hint\"` es un tooltip que se abre con el puntero o el foco.",
        "\"auto\", \"manual\" o \"hint\" (tooltip)", { attributes: ["mode", "bind:mode"], insert: "mode=\"${1|auto,manual,hint|}\"" }),
      prop("placement", "PopoverPlacement", "Dónde se abre respecto al disparador: `top`, `bottom`, `left` o `right`, con `-start` o `-end`; `\"bottom-start\"` por defecto.",
        "Lado y alineación, como bottom-start", { attributes: ["placement", "bind:placement"], insert: `placement="\${1|${placements}|}"` }),
      prop("offset", "number", "Separación en píxeles entre el disparador y el contenido.", "Separación en píxeles", { insert: "bind:offset=\"${1:8}\"" }),
      prop("role", "\"menu\" | \"dialog\" | \"tooltip\"", "Patrón ARIA del contenido: un menú con flechas y búsqueda por letras, un diálogo o un tooltip.",
        "menu, dialog o tooltip", { attributes: ["role", "bind:role"], insert: "role=\"${1|menu,dialog,tooltip|}\"" }),
      prop("label", "string", "`aria-label` del contenido; sin ella, un menú o un diálogo se nombran con el disparador.", "aria-label del contenido", { attributes: ["label", "bind:label"] }),
      prop("class", "string", "Clases del contenido, el elemento con `popover`.", "Clases del contenido", { attributes: ["class", "bind:class"] }),
      prop("triggerClass", "string", "Clases del `<button>` disparador.", "Clases del botón disparador", { attributes: ["triggerClass", "bind:triggerClass"] }),
      prop("triggerId", "string", "`id` del disparador; con un disparador propio, el `id` que lleva.", "id del disparador", { attributes: ["triggerId", "bind:triggerId"] }),
      prop("matchWidth", "boolean", "El contenido mide al menos lo que el disparador.", "Ancho mínimo del disparador", { attributes: ["matchWidth", "bind:matchWidth"], insert: "matchWidth" }),
      prop("delay", "number", "Con `mode=\"hint\"`, milisegundos antes de abrir con el puntero (300).", "Retardo del tooltip en ms"),
      prop("closeDelay", "number", "Con `mode=\"hint\"`, milisegundos antes de cerrar al salir el puntero (150).", "Retardo de cierre del tooltip en ms"),
    ],
    snippets: [
      { name: "default", parameters: "", optional: true, documentation: "El contenido del popover." },
      { name: "trigger", parameters: "", optional: true, documentation: "El contenido del `<button>` disparador que pinta Meeko." },
      { name: "anchor", parameters: "trigger: PopoverTrigger", optional: true, documentation: "Un disparador propio en lugar del botón; aplique los atributos de `trigger` (`id`, `aria-expanded`…)." },
    ],
    component: true,
    module: "@meekojs/meeko/builtins/popover",
    summary: "Popover anclado sobre la API nativa `popover` y *CSS anchor positioning* (con un cálculo en JavaScript donde no existe): el contenido está en la capa superior, "
      + "oculto desde el HTML del servidor. Pinta un `<button>` con `popovertarget`, `aria-expanded`, `aria-controls` y `aria-haspopup`; `model` es la señal de apertura y `on:toggle` emite `{ open }`. "
      + "`Esc` cierra y devuelve el foco; con `role=\"menu\"`, flechas, `Inicio`/`Fin` y búsqueda por letras.",
    guide: popoverGuide,
    completion: "Popover anclado (menú, diálogo o tooltip): <MeekoPopover placement=\"bottom-start\">",
  },
  {
    name: "MeekoSelect",
    propsType: "MeekoSelectProps",
    // The hover of a tag that does not know the type of its options.
    typeArguments: () => "<unknown>",
    props: [
      prop("options", "readonly T[]", "Las opciones, primitivos u objetos; su tipo da el del modelo y el de los snippets.", "Opciones, como colors o users.value", { optional: false, insert: "bind:options=\"$1\"" }),
      prop("multiple", "boolean", "El modelo es un array y cada opción se alterna.", "Elegir varias opciones", { attributes: ["multiple", "bind:multiple"], insert: "multiple" }),
      prop("by", "keyof T | ((a: T, b: T) => boolean)", "Cómo se comparan las opciones con el valor: una clave (`by=\"id\"`) o una función.", "Clave o función de comparación", { attributes: ["by", "bind:by"] }),
      prop("labelBy", "keyof T | ((option: T) => string)", "Etiqueta de cada opción; por defecto, el texto del primitivo o `label`/`name`.", "Clave o función de la etiqueta", { attributes: ["labelBy", "bind:labelBy"] }),
      prop("disabledBy", "keyof T | ((option: T) => boolean)", "Qué opciones están deshabilitadas; por defecto, las que tienen `disabled: true`.", "Clave o función de deshabilitada", { attributes: ["disabledBy", "bind:disabledBy"] }),
      prop("groupBy", "keyof T | ((option: T) => string | undefined)", "Grupo de cada opción, con un encabezado por grupo.", "Clave o función del grupo", { attributes: ["groupBy", "bind:groupBy"] }),
      prop("placeholder", "string", "Texto del disparador sin valor elegido.", "Texto sin valor", { attributes: ["placeholder", "bind:placeholder"] }),
      prop("name", "string", "`name` de los `<input type=\"hidden\">` que se envían con el `<form>`.", "name del formulario", { attributes: ["name", "bind:name"] }),
      prop("required", "boolean", "Exige un valor al enviar el `<form>`.", "Valor obligatorio", { attributes: ["required", "bind:required"], insert: "required" }),
      prop("disabled", "boolean", "Deshabilita el disparador; los valores no se envían.", "Deshabilitado", { attributes: ["disabled", "bind:disabled"], insert: "disabled" }),
      prop("searchable", "boolean", "El disparador es un combobox con `<input>` que filtra las opciones.", "Con búsqueda", { attributes: ["searchable", "bind:searchable"], insert: "searchable" }),
      prop("filter", "SelectFilter<T>", "Búsqueda propia, síncrona o asíncrona (`(query, { options, signal }) => …`).", "Búsqueda propia, también async"),
      prop("max", "number", "Con `multiple`, cuántas opciones se pueden elegir como mucho.", "Máximo de opciones elegidas"),
      prop("field", "SelectField<…>", "El campo de `useForm`, `form.field('x')`: `id`, `name`, valor, `aria-invalid` y `aria-describedby`.", "Campo de useForm", { insert: "bind:field=\"form.field('$1')\"" }),
      prop("id", "string", "`id` del disparador, para un `<label for>`.", "id del disparador", { attributes: ["id", "bind:id"] }),
      prop("label", "string", "`aria-label` del disparador y de la lista, sin `<label>`.", "aria-label", { attributes: ["label", "bind:label"] }),
      prop("describedBy", "string", "`aria-describedby` del disparador.", "aria-describedby", { attributes: ["describedBy", "bind:describedBy"] }),
      prop("invalid", "boolean", "Marca el disparador con `aria-invalid=\"true\"`.", "aria-invalid"),
      prop("class", "string", "Clases del elemento raíz.", "Clases de la raíz", { attributes: ["class", "bind:class"] }),
      prop("listClass", "string", "Clases de la lista, el elemento con `popover`.", "Clases de la lista", { attributes: ["listClass", "bind:listClass"] }),
      prop("placement", "PopoverPlacement", "Dónde se abre la lista; `\"bottom-start\"` por defecto.", "Lado y alineación de la lista", { attributes: ["placement", "bind:placement"], insert: `placement="\${1|${placements}|}"` }),
      prop("offset", "number", "Separación en píxeles entre el disparador y la lista.", "Separación en píxeles"),
    ],
    snippets: [
      { name: "option", parameters: "option: T, state: SelectOptionState", optional: true, documentation: "Contenido de cada opción; `state` dice si está elegida, activa o deshabilitada." },
      { name: "value", parameters: "option: T", optional: true, documentation: "Cómo se muestra cada valor elegido en el disparador." },
      { name: "group", parameters: "name: string", optional: true, documentation: "Encabezado de un grupo de `groupBy`." },
      { name: "empty", parameters: "", optional: true, documentation: "Lo que se muestra sin opciones; por defecto, «Sin resultados»." },
      { name: "loading", parameters: "", optional: true, documentation: "Lo que se muestra mientras una búsqueda asíncrona carga." },
    ],
    component: true,
    module: "@meekojs/meeko/builtins/select",
    summary: "Select accesible sobre `<MeekoPopover>`: un `role=\"combobox\"` con `aria-activedescendant` (el foco se queda en el disparador o el `<input>` de `searchable`) y un `role=\"listbox\"`. "
      + "`model` es el valor (un array con `multiple`), tipado por `options`; `by` compara objetos, `groupBy` agrupa, `max` limita y `name` envía `<input type=\"hidden\">`. "
      + "Sin estilos visuales: `data-active`, `data-selected` y `data-disabled` en las opciones y `data-open` en la raíz.",
    guide: selectGuide,
    completion: "Select accesible con búsqueda y múltiple: <MeekoSelect model=\"value\" bind:options=\"options\">",
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
