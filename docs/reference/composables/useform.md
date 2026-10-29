---
title: useForm
group: composables
since: 1.2.0
description: Estado de un formulario en un componente, con una señal por campo, validación con un Standard Schema, errores del servidor en cada campo, envío y reinicio.
symbols:
  - "@meekojs/meeko/framework#useForm"
types:
  - "@meekojs/meeko/framework#Form"
  - "@meekojs/meeko/framework#FormSubmission"
  - "@meekojs/meeko/framework#FormField"
related:
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#ApiError"
  - "syntax:model"
  - "@meekojs/meeko#useId"
  - "autoimport:useApiMutation"
  - docs/framework.md#formularios-useform
  - docs/framework.md#errores-de-validación-en-formularios
  - docs/framework.md#formularios-sin-javascript-form
---

`useForm` reúne lo que repite cada formulario: una señal escribible por campo para `model`, la validación con un [Standard Schema](https://standardschema.dev) (como los de Valibot) al enviar, los `issues` de un `400` del servidor repartidos por campo, un mensaje para el formulario completo, `pending`, `submitted`, `dirty`, `reset` y `commit`. Se llama en el nivel superior del `<script>` de un componente y se autoimporta en las aplicaciones del framework.

El formulario es estado del componente: no viaja en el payload. El servidor lo renderiza con `initial` y el navegador vuelve a crearlo con el mismo `initial` al hidratar.

## Uso

```html
<!-- app/pages/categories/new.meeko -->
<script lang="ts">
import * as v from "valibot";

const categoryInput = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, "Escribe un nombre.")),
});

const form = useForm({
  schema: categoryInput,
  initial: { name: "" },
  submit: (values) => api.categories.post({ body: values }),
});
</script>

<template>
  <form on:submit="form.submit" novalidate>
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
    <label>Nombre <input model="form.fields.name"></label>
    <p if:when="form.errors.value.name">{form.errors.value.name}</p>
    <button bind:disabled="form.pending.value">Guardar</button>
  </form>
</template>
```

`on:submit="form.submit"` pasa la función como manejador: `submit` llama a `event.preventDefault()`, valida con el schema y, si los datos son válidos, ejecuta tu `submit` con la salida del schema.

## Opciones

`useForm(options)` recibe un objeto:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `schema` | Standard Schema v1 | sin schema | Valida los campos al enviar. Con schema, los campos tienen el tipo de su **entrada** y `submit` recibe su **salida** (un `v.transform` puede convertir texto en número). Sin schema, sólo valida el servidor. |
| `initial` | `Values` | obligatorio | Valor inicial de cada campo. Con schema, una clave por cada clave de su entrada, también las opcionales (con `undefined`). Debe depender sólo de props, datos de la ruta y estado, porque el navegador lo vuelve a evaluar al hidratar. |
| `submit` | `(values) => Result \| PromiseLike<Result>` | obligatorio | Envía los datos válidos y devuelve el resultado, o rechaza. Recibe la salida del schema, o los valores de los campos sin schema. |
| `errorMessage` | `(failure: unknown) => string` | `failure.message` | Texto de `error` para un fallo sin `issues`, como un `409` o un fallo de red. En un `ClientError`, el `message` por defecto es su `code`. |
| `onSuccess` | `(result, form) => void` | ninguno | Desde `1.5`. Se ejecuta tras un envío correcto, con `submitted` ya en `true`. Un error que lance va al observador de errores del componente y no cambia el resultado del envío. |
| `focusInvalid` | `boolean` | `false` | Desde `1.5`. Tras un envío con errores en los campos, mueve el foco al primer control inválido del `<form>` del evento una vez pintados los mensajes. |
| `action` | `string` | ninguna | Desde `1.7`. Ruta del endpoint con `form` al que se envía el `<form method="post">` sin JavaScript, como `"/api/feedback"`. Al volver de ese envío, el SSR pinta su resultado: `errors`, `error` y `failure`, o `submitted`, y los valores de los campos que el endpoint lista en `form.echo` (por defecto, ninguno: los demás parten de `initial`). |

## Valor devuelto

Un `Form<Values, Result>`. `fields` son señales escribibles; el resto de señales son de sólo lectura y `csrfToken` es un texto.

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `fields` | `{ [K in keyof Values]: Signal<Values[K]> }` | Una señal por campo, para `model` en `<input>`, `<textarea>` y `<select>`, y para `model:nombre` en un componente. |
| `errors` | `ReadonlySignal<{ [ruta]?: string }>` | Primer mensaje de cada ruta con error: `errors.value.name`, `errors.value["items.0.name"]`. Un campo sin error no tiene clave. |
| `error` | `ReadonlySignal<string \| null>` | Mensaje del formulario completo: un issue con ruta `""`, un issue de un campo que el formulario no tiene o el texto de `errorMessage`. |
| `failure` | `ReadonlySignal<Error \| null>` | Error original del último envío fallido, también el `ClientError` de un `400`. |
| `pending` | `ReadonlySignal<boolean>` | `true` mientras un schema asíncrono valida o se ejecuta `submit`. |
| `submitted` | `ReadonlySignal<boolean>` | `true` cuando el último envío terminó bien. |
| `dirty` | `ReadonlySignal<boolean>` | `true` si algún campo difiere de los valores iniciales. Compara arrays, objetos planos y fechas por contenido. |
| `submit(event?)` | `Promise<Result \| undefined>` | Envía. Resuelve con lo que devuelve tu `submit`, o con `undefined` si los datos no son válidos, si el envío falla o si ya había uno en curso. Nunca rechaza. |
| `trySubmit(event?)` | `Promise<FormSubmission<Result>>` | Desde `1.5`. Envía igual, pero resuelve con cómo terminó: `{ ok: true, result }` u `{ ok: false, reason }` con `"invalid"`, `"error"` o `"skipped"`. Nunca rechaza. |
| `reset(values?)` | `void` | Vuelve a los valores iniciales, o a ellos combinados con `values`, que pasan a ser la referencia de `dirty`. Borra `errors`, `error`, `failure` y `submitted` y descarta el resultado de una validación o un envío en curso. |
| `commit(values?)` | `void` | Desde `1.5`. Escribe `values` y toma los valores actuales como nuevos valores iniciales: `dirty` vuelve a `false`. No borra `submitted`, `errors`, `error` ni `failure`. |
| `field(name)` | `FormField<Values[K]>` | Desde `1.5`. Las piezas de un campo para un componente propio: su señal, su mensaje, `invalid`, `name` e IDs estables entre SSR e hidratación. Devuelve siempre el mismo objeto para el mismo campo. |
| `csrfToken` | `string \| undefined` | Desde `1.7`. El token CSRF de la sesión para el campo oculto `_csrf` de un formulario nativo, o `undefined` sin sesión: en SSR, el de la petición; en el navegador, el de la meta `meeko-csrf-token`. Es un texto, no una señal. |

## Ejemplos

### Errores del servidor en cada campo

Sin schema en el navegador, el servidor valida. La respuesta `400` de una entrada que no supera el schema de `defineApiRoute` trae `issues` con `path` y `message`, y `useForm` pone cada mensaje en su campo. Un `ApiError` con `issues` (desde `1.5`) hace lo mismo con otro estado, como un `409`:

<!-- no-check -->
```ts
// server/api/signup.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { signupInput, signupResult } from "../../shared/schemas/signup";

export default defineApiRoute({
  body: signupInput,
  response: signupResult,
  status: 201,
  handler: async ({ body }) => {
    if (await emailTaken(body.email)) {
      throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
    }
    return createUser(body);
  },
});
```

```html
<!-- app/pages/signup.meeko -->
<script lang="ts">
const form = useForm({
  initial: { email: "", password: "" },
  submit: (values) => api.signup.post({ body: values }),
  errorMessage: (failure) => isClientError(failure) ? "No se pudo crear la cuenta." : "No se pudo conectar. Inténtalo de nuevo.",
});
</script>

<template>
  <form on:submit="form.submit" novalidate>
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
    <label>Correo <input type="email" model="form.fields.email"></label>
    <p if:when="form.errors.value.email">{form.errors.value.email}</p>
    <label>Contraseña <input type="password" model="form.fields.password"></label>
    <p if:when="form.errors.value.password">{form.errors.value.password}</p>
    <button bind:disabled="form.pending.value">Crear cuenta</button>
  </form>
</template>
```

Con el `409`, `form.errors.value.email` es «Ese correo ya tiene una cuenta.», `form.error.value` es `null` y `form.failure.value` es el `ClientError`. Sin schema, cambiar el campo borra su mensaje del servidor.

### Editar un registro y guardar como nueva referencia

`initial` sale de los datos de la página. Tras guardar, `onSuccess` llama a `commit` con lo que devolvió el servidor: `dirty` vuelve a `false` y el «Guardado» de `submitted` se mantiene.

```html
<!-- app/pages/profile.meeko -->
<script server lang="ts">
export const profile = await loadProfile(usePage().context);
</script>

<script lang="ts">
const form = useForm({
  schema: profileInput,
  initial: { name: profile.name, bio: profile.bio },
  submit: (values) => api.profile.put({ body: values }),
  onSuccess: (saved, form) => form.commit({ name: saved.name, bio: saved.bio }),
});
</script>

<template>
  <form on:submit="form.submit">
    <input model="form.fields.name">
    <textarea model="form.fields.bio"></textarea>
    <button bind:disabled="!form.dirty.value || form.pending.value">Guardar</button>
    <p if:when="form.submitted.value && !form.dirty.value">Guardado.</p>
  </form>
</template>
```

### Saber cómo terminó el envío

`submit` resuelve `undefined` tanto si los datos no son válidos como si falla la red. `trySubmit` distingue los casos:

```ts
import { signal } from "@meekojs/meeko";
import { useForm } from "@meekojs/meeko/framework";

const lastSaved = signal<string | null>(null);

const form = useForm({
  initial: { title: "" },
  submit: async (values): Promise<{ updatedAt: string }> => {
    const response = await fetch("/api/notes", { method: "POST", body: JSON.stringify(values) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as { updatedAt: string };
  },
});

async function save(event: SubmitEvent): Promise<void> {
  const outcome = await form.trySubmit(event);
  if (outcome.ok) lastSaved.value = outcome.result.updatedAt;
  else if (outcome.reason === "error") console.warn(outcome.failure);
  // "invalid": los mensajes ya están en form.errors; "skipped": había otro envío en curso.
}
```

### Un componente de campo con `form.field`

`form.field(name)` da al componente de campo todo lo que necesita sin recibir el formulario entero, con IDs que coinciden entre el HTML del servidor y la hidratación:

```html
<!-- app/components/AppField.meeko -->
<script lang="ts">
import type { FormField } from "@meekojs/meeko/framework";

const props = defineProps<{ field: FormField<string>; label: string; type?: string }>();
</script>

<template>
  <label bind:for="props.field.id">{props.label}</label>
  <input bind:id="props.field.id" bind:name="props.field.name" bind:type="props.type ?? 'text'" model="props.field.value"
    bind:aria-invalid="props.field.invalid.value ? 'true' : null" bind:aria-describedby="props.field.describedBy.value">
  <p if:when="props.field.error.value" bind:id="props.field.errorId">{props.field.error.value}</p>
</template>
```

```html
<form on:submit="form.submit" novalidate>
  <AppField bind:field="form.field('email')" label="Correo" type="email" />
  <AppField bind:field="form.field('password')" label="Contraseña" type="password" />
</form>
```

### Un formulario que funciona sin JavaScript (desde 1.7)

Con `form` en el endpoint y `action` en `useForm`, el mismo formulario se envía con JSON cuando hay JavaScript y como un `<form method="post">` nativo antes de hidratar o sin él. Cada control lleva el `name` de su campo:

<!-- no-check -->
```ts
// server/api/feedback.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { feedbackInput, feedbackSaved } from "../../shared/schemas/feedback.js";

export default defineApiRoute({ body: feedbackInput, response: feedbackSaved, form: { echo: ["comment"] }, handler: ({ body }) => saveFeedback(body) });
```

```html
<!-- app/components/Feedback.meeko -->
<script lang="ts">
const route = useRoute();
const form = useForm({
  schema: feedbackInput,
  initial: { page: route.path.value, helpful: false, comment: "" },
  action: "/api/feedback",
  submit: (values) => api.feedback.post({ body: values }),
});
</script>

<template>
  <form method="post" action="/api/feedback" on:submit="form.submit" novalidate>
    <input type="hidden" name="return" bind:value="route.url.value">
    <input type="hidden" name="_csrf" bind:value="form.csrfToken ?? ''">
    <input type="hidden" name="page" bind:value="form.fields.page.value">
    <p if:when="form.submitted.value">¡Gracias!</p>
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
    <button name="helpful" value="true" on:click="() => { form.fields.helpful.value = true; }">Sí</button>
    <button name="helpful" value="false" on:click="() => { form.fields.helpful.value = false; }">No</button>
    <textarea name="comment" model="form.fields.comment"></textarea>
    <p if:when="form.errors.value.comment">{form.errors.value.comment}</p>
  </form>
</template>
```

Sin JavaScript, el servidor valida con el mismo schema de `body`, responde `303` de vuelta a `return` y deja el resultado en una cookie de un solo uso; el SSR de la página lo pinta en el formulario cuya `action` coincide, y la hidratación conserva lo mismo. Sólo vuelven los valores de los campos de `form.echo` (aquí, el comentario); el resto de campos muestra `initial`.

### Una confirmación que depende de otro campo

Desde `1.5`, cada cambio vuelve a validar también los campos que ya muestran un error del schema. Con una regla de Valibot que lleva el error a `confirm`, corregir la contraseña quita «Las contraseñas no coinciden» sin tocar la confirmación:

<!-- no-check -->
```ts
import * as v from "valibot";

export const passwordInput = v.pipe(
  v.object({ password: v.pipe(v.string(), v.minLength(10, "Usa al menos 10 caracteres.")), confirm: v.string() }),
  v.forward(
    v.partialCheck([["password"], ["confirm"]], (input) => input.password === input.confirm, "Las contraseñas no coinciden."),
    ["confirm"],
  ),
);
```

## Errores comunes

### Pasar `.value` a `model`

`model` necesita la señal del campo, no su valor.

```html bad
<input model="form.fields.name.value">
```

`meeko check` da `TS2322: Type 'string' is not assignable to type '{ value: string; }'` en el atributo, y en ejecución el enlace lanza `TypeError: Meeko model expects a writable signal, not a computed signal or a plain value`.

```html good
<input model="form.fields.name">
```

### Llamar a `submit` en el manejador

`on:submit` espera una función. `form.submit()` se ejecuta al renderizar y pasa una promesa.

```html bad
<form on:submit="form.submit()">
```

`meeko check` da `TS2345: Argument of type 'Promise<…>' is not assignable to parameter of type '(event: SubmitEvent & { readonly currentTarget: HTMLFormElement; }) => unknown'`.

```html good
<form on:submit="form.submit">
```

Para hacer algo con el resultado, envuelve la llamada en una función del script: `async function save(event: SubmitEvent) { const saved = await form.submit(event); … }` y `on:submit="save"`.

### Un campo que no existe

Los campos salen de `initial` (o de la entrada del schema), así que un nombre mal escrito es un error de tipos en `fields`, en `errors` y en `field`:

```html bad
<input model="form.fields.nmae">
<p>{form.errors.value.nmae}</p>
<AppField bind:field="form.field('nmae')" label="Nombre" />
```

`meeko check` da `TS2339: Property 'nmae' does not exist on type '{ readonly name: Signal<string>; }'` en `fields` y `errors`, y `TS2345: Argument of type '"nmae"' is not assignable to parameter of type '"name"'` en `field`. Si el nombre llega sin tipos, `form.field` lanza en ejecución `TypeError: useForm(): the form has no field "nmae"`.

```html good
<input model="form.fields.name">
<p>{form.errors.value.name}</p>
<AppField bind:field="form.field('name')" label="Nombre" />
```

### Un campo numérico en un `<input type="number">`

Un `<input>`, también el de tipo `number`, entrega texto. `model` exige una señal `string`.

```ts bad
const form = useForm({ initial: { age: 0 }, submit: save });
// <input type="number" model="form.fields.age">
```

`meeko check` da `TS2322: Type 'Signal<number>' is not assignable to type '{ value: string; }'`. Guarda el texto en el campo y conviértelo en el schema, cuya salida es la que recibe `submit`:

<!-- no-check -->
```ts good
const ageInput = v.object({ age: v.pipe(v.string(), v.transform(Number), v.integer("Escribe un número entero.")) });
const form = useForm({ schema: ageInput, initial: { age: "" }, submit: (values) => save(values) }); // values.age es number
// <input type="number" model="form.fields.age">
```

### `initial` sin todas las claves del schema

Con schema, `initial` necesita un valor por cada clave de la entrada, también las opcionales.

<!-- no-check -->
```ts bad
const signupInput = v.object({ name: v.string(), email: v.string() });
const form = useForm({ schema: signupInput, initial: { name: "" }, submit });
```

`meeko check` da `TS2769: No overload matches this call` con `Property 'email' is missing in type '{ name: string; }' but required in type 'Complete<{ name: string; email: string; }>'`.

<!-- no-check -->
```ts good
const form = useForm({ schema: signupInput, initial: { name: "", email: "" }, submit });
```

### Mutar el array de un campo

Una señal avisa cuando se le asigna un valor nuevo. `push` cambia el mismo array: ni la plantilla ni `dirty` se enteran, y no hay ningún error que lo señale.

```ts bad
form.fields.tags.value.push(tag);
```

<!-- no-check -->
```ts good
form.fields.tags.value = [...form.fields.tags.value, tag];
```

### `csrfToken` como si fuera una señal

`csrfToken` es un texto, o `undefined` sin sesión.

```html bad
<input type="hidden" name="_csrf" bind:value="form.csrfToken.value">
```

`meeko check` da `TS18048: 'form.csrfToken' is possibly 'undefined'` y `TS2551: Property 'value' does not exist on type 'string'. Did you mean 'valueOf'?`.

```html good
<input type="hidden" name="_csrf" bind:value="form.csrfToken ?? ''">
```

## Notas

- **Dónde llamarlo.** En el nivel superior del `<script>`, antes de cualquier `await`, como `useId`: los IDs de `form.field` salen de `useId` y dependen del orden de las llamadas. No necesita `await` ni tiene la restricción `MEEK054` de `useApi`.
- **SSR.** El servidor renderiza el formulario con `initial` y nunca envía: un `submit` o `trySubmit` llamado mientras el script sólo produce HTML (SSR o la pasada en seco de una navegación) resuelve `{ ok: false, reason: "skipped" }`.
- **Hidratación.** Los campos no viajan en el payload ni los conserva HMR: el navegador vuelve a ejecutar `useForm` con el mismo `initial`. Lo que el usuario escriba antes de hidratarse la página se conserva, porque `model` lo copia a la señal del campo al terminar la hidratación. Desde `1.7`, con `action`, el resultado de un envío sin JavaScript sí viaja en el estado de la página, para que la hidratación pinte lo mismo que el SSR; el navegador lo usa una sola vez.
- **Cuándo valida.** El schema se ejecuta al enviar, no mientras se escribe. Tras un error, el campo se vuelve a validar en cada cambio y su mensaje desaparece en cuanto es válido; un campo sin error no se valida hasta el siguiente envío. Si el schema es asíncrono, `pending` vale `true` mientras valida, y sólo se aplica la validación más reciente.
- **Envíos simultáneos.** Mientras hay un envío en curso, otro `submit` se ignora (resuelve `undefined`) y también evita el envío nativo del navegador.
- **Fallos inesperados.** Un `ClientError` es una respuesta prevista del servidor. Cualquier otro error (un fallo de red, un error en tu `submit` o un schema que lanza) llega además al observador de errores del componente, `provideErrorHandler` o el `onError` de `mountClientApp`, con la fuente `"event"`; sin observador, se escribe en la consola.
- **Seguridad sin JavaScript.** Un envío nativo exige un `Origin` permitido (`403 INVALID_ORIGIN` si falta) y, con sesión, el token en `_csrf` (`403 INVALID_CSRF`). `return` y `_csrf` nunca llegan al schema.
- **Accesibilidad.** Marca los controles con `aria-invalid` y enlaza el mensaje con `aria-describedby` (`form.field` da `describedBy`). Con `focusInvalid: true`, el foco va al primer control con error, buscado por su `name`, por el `id` de `form.field` o por `aria-invalid="true"`.

> [!NOTE]
> `meeko check` comprueba `initial` contra la entrada del schema, los nombres de `fields`, las rutas de `errors` y que cada `model` tenga el tipo del control. Ejecútalo en CI: todos los errores de tipos de esta página los da antes de llegar al navegador.
