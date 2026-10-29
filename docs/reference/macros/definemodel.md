---
title: defineModel
group: macros
since: 1.1.0
description: Declara un modelo del componente, una señal escribible que el padre comparte con model o model:nombre, con un valor por defecto opcional.
symbols:
  - "syntax:definemodel"
related:
  - "syntax:model"
  - "syntax:defineprops"
  - "syntax:defineemits"
  - "@meekojs/meeko#Signal"
  - "@meekojs/meeko/framework#useForm"
  - docs/api.md#modelos-de-componente-definemodel-y-model
---

`defineModel<T>()` declara un valor que el padre comparte con el componente en los dos sentidos, y devuelve una `Signal<T>` escribible. El padre pasa su señal con `model="señal"` (el modelo por defecto) o `model:nombre="señal"`; leer y escribir en el hijo lee y escribe la señal del padre. Es una macro de compilación: no se importa.

Es la forma de escribir un campo de formulario propio, un interruptor o un diálogo con `open` sin la pareja prop + evento.

## Uso

```html
<!-- app/components/AppInput.meeko -->
<script lang="ts">
const props = defineProps<{ label: string }>();
const value = defineModel<string>();                              // modelo por defecto, obligatorio
const touched = defineModel<boolean>("touched", { default: false }); // modelo con nombre, opcional
</script>

<template>
  <label>{props.label} <input model="value" on:blur="() => touched.value = true"></label>
</template>
```

```html
<!-- en el padre, con const name = signal("") y const nameTouched = signal(false) -->
<AppInput label="Nombre" model="name" model:touched="nameTouched" />
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `T` (argumento de tipo) | cualquier tipo | obligatorio | El tipo del valor. Sin él es `MEEK064`. |
| `name` | literal de texto | `"default"` | Nombre del modelo, un identificador que el padre usa en `model:nombre`. Debe ser un literal (`MEEK064`). |
| `options` | `{ default: T }` | ninguno | `default` hace el modelo opcional: si el padre no lo pasa, el hijo usa una señal local con ese valor. Sólo admite `default` (`MEEK064`). |

Las formas válidas son `defineModel<T>()`, `defineModel<T>({ default })`, `defineModel<T>("nombre")` y `defineModel<T>("nombre", { default })`.

## Valor devuelto

`Signal<T>`: la señal que pasa el padre o, si no la pasa y hay `default`, una señal local con ese valor inicial.

- Sin `default`, el modelo es obligatorio: omitirlo en el padre es un error de tipos y, en ejecución, un `TypeError`.
- Los modelos no son props: no aparecen en `ComponentProps`; el módulo compilado exporta su tipo en `ComponentModels`.

## Ejemplos

### Un interruptor con modelo por defecto opcional

Con `{ default }`, el componente funciona también sin `model`, con su propio estado:

```html
<!-- app/components/AppSwitch.meeko -->
<script lang="ts">
const props = defineProps<{ label: string }>();
const on = defineModel<boolean>({ default: false });
</script>

<template>
  <button type="button" role="switch" bind:aria-checked="on.value ? 'true' : 'false'" on:click="() => on.value = !on.value">{props.label}</button>
</template>
```

```html
<AppSwitch label="Notificaciones" model="notify" />
<AppSwitch label="Modo compacto" />
```

### Un diálogo con `open`

El padre abre el diálogo y el hijo lo cierra escribiendo en la misma señal:

```html
<!-- app/components/AppDialog.meeko -->
<script lang="ts">
const open = defineModel<boolean>("open");
const snippets = defineSnippets<{ default: [] }>();
</script>

<template>
  <div if:when="open.value" role="dialog" aria-modal="true">
    <render snippet="snippets.default" />
    <button type="button" on:click="() => open.value = false">Cerrar</button>
  </div>
</template>
```

```html
<button type="button" on:click="() => dialogOpen.value = true">Abrir</button>
<AppDialog model:open="dialogOpen"><p>¿Seguro?</p></AppDialog>
```

### Un campo de `useForm`

`form.fields.x` es una señal escribible, así que llega directamente al modelo:

```html
<script lang="ts">
const form = useForm({ initial: { name: "" }, submit: async (values) => values });
</script>

<template>
  <form on:submit="form.submit">
    <AppInput label="Nombre" model="form.fields.name" />
  </form>
</template>
```

## Errores comunes

### Opciones distintas de `default`

```html bad
<script lang="ts">
const value = defineModel<string>({ default: "", required: true });
</script>
```

`MEEK064: Las opciones de defineModel sólo admiten default: { default: value }`. Un modelo es obligatorio cuando no tiene `default`.

```html good
<script lang="ts">
const value = defineModel<string>();
</script>
```

### Un nombre calculado

```html bad
<script lang="ts">
const name = "open";
const open = defineModel<boolean>(name, { default: false });
</script>
```

`MEEK064: El nombre de modelo de defineModel debe ser un literal de texto, como defineModel<boolean>("open")`. Sin argumento de tipo, el error es `MEEK064: defineModel necesita un argumento de tipo, como defineModel<string>()`.

```html good
<script lang="ts">
const open = defineModel<boolean>("open", { default: false });
</script>
```

### No pasar un modelo obligatorio

```html bad
<AppInput label="Nombre" />
```

`meeko check` da `TS2741: Property '"default"' is missing in type '{}' but required in type 'ComponentModels'.` Pasa la señal, o haz el modelo opcional con `defineModel<string>({ default: "" })`.

```html good
<AppInput label="Nombre" model="name" />
```

### Pasar un valor o un `computed`

```html bad
<AppInput label="Nombre" model="name.value" />
<AppInput label="Nombre" model="upper" />
```

`meeko check` da `TS2322: Type 'string' is not assignable to type 'Signal<string>'.` y, con `const upper = computed(…)`, `TS2345` con `"a model needs a writable signal; computed and readonly signals cannot be written"`. Una señal de otro tipo da `TS2322: Type 'Signal<number>' is not assignable to type 'Signal<string>'.`

```html good
<AppInput label="Nombre" model="name" />
```

### Un modelo que el hijo no declara, o pasado como prop

```html bad
<AppInput label="Nombre" model="name" model:opened="open" />
<AppInput label="Nombre" model="name" model:touched="touched" bind:touched="touched.value" />
```

`meeko check` da `TS2353: Object literal may only specify known properties, and '"opened"' does not exist in type 'ComponentModels'.` y `MEEK066: model:touched y bind:touched pasan los dos touched; un modelo no es una prop, deja sólo model:touched`.

```html good
<AppInput label="Nombre" model="name" model:touched="touched" />
```

## Notas

- **Estado y SSR.** La señal del padre pertenece al padre: no forma parte del estado que el hijo transfiere en SSR ni del que conserva HMR. El SSR lee su valor y la hidratación conecta la misma señal. Una señal local creada con `default` sí es estado del hijo.
- **Al cambiar de señal.** Si el padre pasa otra señal en un `model`, el hijo se vuelve a montar, conservando sus señales editables por nombre.
- **Dónde va.** En su propia declaración `const` de nivel superior con un nombre simple, una vez por nombre de modelo (`MEEK063`), antes del primer `await` de navegador (`MEEK058`).
- **Formularios.** Dentro del hijo, el modelo se enlaza a un control con `model="value"`; el padre no necesita escuchar ningún evento.
