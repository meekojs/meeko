---
title: defineModel
group: macros
since: 1.1.0
description: Declara un modelo del componente, una señal escribible que el padre comparte con model o model:nombre, o pasa como prop y evento, con un valor por defecto opcional.
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

Es la forma de escribir un campo de formulario propio, un interruptor o un diálogo con `open` sin escribir a mano la pareja prop + evento. Desde `1.8` el padre también puede usar esa pareja, sin que el hijo cambie nada: `bind:modelValue` y `on:update:modelValue`. Véase [Por prop y evento](#por-prop-y-evento).

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

| Parámetro               | Tipo             | Por defecto | Descripción                                                                                                                              |
| ----------------------- | ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `T` (argumento de tipo) | cualquier tipo   | obligatorio | El tipo del valor. Sin él es `MEEK064`.                                                                                                  |
| `name`                  | literal de texto | `"default"` | Nombre del modelo, un identificador que el padre usa en `model:nombre`. Debe ser un literal (`MEEK064`).                                 |
| `options`               | `{ default: T }` | ninguno     | `default` hace el modelo opcional: si el padre no lo pasa, el hijo usa una señal local con ese valor. Sólo admite `default` (`MEEK064`). |

Las formas válidas son `defineModel<T>()`, `defineModel<T>({ default })`, `defineModel<T>("nombre")` y `defineModel<T>("nombre", { default })`.

## Valor devuelto

`Signal<T>`: la señal que pasa el padre o, si no la pasa y hay `default`, una señal local con ese valor inicial.

- Sin `default`, el modelo es obligatorio: el padre pasa `model` o `bind:modelValue`. Omitir los dos es un error de tipos y, en ejecución, un `TypeError`; `on:update:modelValue` solo no basta.
- El hijo siempre recibe una `Signal<T>` y no sabe qué forma usó el padre. La señal va en `ComponentModels`; la prop y el evento, en `ComponentProps`, y `<Nombre>Props` y `<Nombre>Emits` los conocen.

## Por prop y evento

Desde `1.8`, un componente con `defineModel` acepta el valor como prop, también dentro de `bind="objeto"`, y su cambio como evento. El modelo sin nombre se llama `modelValue`; uno con nombre, por ese nombre:

```html
<AppInput model="name" />
<AppInput bind:modelValue="name.value" on:update:modelValue="(next) => (name.value = next)" />
<AppInput bind:modelValue="'hola'" />
<AppInput bind="option.props" />
<!-- option.props = { modelValue: "hola", placeholder: "…" } -->
<AppInput model="name" bind:touched="touched.value" on:update:touched="(next) => (touched.value = next)" />
```

| El padre pasa                              | El valor del hijo                | Cuando el hijo escribe                                                                   |
| ------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `model="señal"`                            | La señal del padre               | Escribe en esa señal                                                                     |
| `bind:modelValue` y `on:update:modelValue` | Sigue a la prop                  | Llama al evento; el valor sólo cambia si el padre cambia la prop, y si no, vuelve a ella |
| Sólo `bind:modelValue`, o dentro de `bind` | Valor inicial, y sigue a la prop | Se queda en el hijo hasta que la prop cambie                                             |
| Sólo `on:update:modelValue`                | `default`, en una señal local    | Se queda en el hijo y llama al evento                                                    |
| Nada                                       | `default`, en una señal local    | Se queda en el hijo                                                                      |

- **Prop `undefined`.** Una prop `undefined` toma el `default`, como en `defineProps`; con `bind:modelValue` y el evento escritos, el padre sigue decidiendo cada escritura.
- **Escribir el mismo valor** no llama al evento.
- **SSR.** El HTML sale con el valor de la prop, y la señal que la sigue no viaja en el estado del hijo: el padre ya la tiene. Tampoco la conserva HMR, ni una reconstrucción de un hijo con `await` de datos: una escritura local de la tercera fila vuelve entonces al valor de la prop.
- **`model` y la prop a la vez** son `MEEK066`. Con `model`, el hijo escribe en la señal y nunca emitiría el evento: para observar los cambios, usa un `effect` sobre la señal. En ejecución, si un `bind="objeto"` trae `modelValue` junto a `model`, gana `model`.
- **`bind:default` y `on:update:default` no existen:** `default` es el nombre interno del modelo sin nombre.
- **La prop y el evento son del modelo.** No aparecen en `Object.keys(props)` ni en `...rest`, así que `bind="rest"` no los lleva a un elemento. Declararlos también en `defineProps` o `defineEmits` es `MEEK063`, salvo con un tipo importado: un envoltorio puede usar `defineProps<UIInputProps>()` y declarar su propio modelo.
- **En un `bind` no va el evento:** `onUpdate:modelValue` es una clave `on*` (`MEEK113`). Escribe `on:update:modelValue`.

### Un padre que guarda con `await`

Si el manejador de `on:update:modelValue` devuelve una promesa, lo escrito se mantiene mientras esté pendiente: no se pierde texto y el cursor no salta. Cada escritura nueva vuelve a llamar al manejador.

```html good
<AppInput bind:modelValue="name.value" on:update:modelValue="async (next) => { await save(next); name.value = next; }" />
```

- **Al terminar la última escritura**, el hijo vuelve a seguir a la prop. Si el padre no la cambió, el control vuelve a su valor.
- **Si rechaza,** ocurre lo mismo, y el error llega al manejador de errores de la aplicación (`provideErrorHandler`), sin quedar como rechazo sin capturar.
- **Si la prop cambia mientras hay una escritura pendiente,** lo escrito se queda hasta que esa escritura termine, y entonces decide la prop. No se aplica antes porque el hijo no distingue ese cambio del guardado de una escritura anterior, que borraría lo escrito después.
- **Si una escritura anterior termina después de la última,** el hijo conserva el valor. La señal del padre sí toma lo que escriba su código, así que, si el orden importa, el padre debe descartar las respuestas antiguas.
- **Al desmontar,** una escritura pendiente ya no cambia el modelo. Si rechaza entonces, el error sólo va a la consola: su componente ya no está.

Un manejador síncrono no cambia: el control vuelve a la prop en cuanto termina, si el padre no la actualizó.

### Si vienes de Vue

`defineModel` se comporta como el de Vue con `bind:modelValue` y `on:update:modelValue`, que corresponden a `:modelValue` y `@update:modelValue`. `model="señal"` corresponde a `v-model`, con una diferencia: recibe la señal, no su valor, así que se escribe `model="name"` y no `model="name.value"`, y el hijo escribe directamente en ella en lugar de emitir. Por eso `model` no se combina con `on:update:modelValue`, que en Vue sí se puede escribir junto a `v-model`. Otra diferencia: si un manejador síncrono no acepta el valor, el control vuelve al de la prop, también en un `<input>`. Un padre con `await` funciona como en Vue: el `<input>` conserva lo escrito mientras guarda. Además, aquí `value.value` también da lo escrito durante ese tiempo y el cursor no salta al terminar.

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

`meeko check` y el editor dan `TS2741: Falta el modelo obligatorio de este componente: pásalo con model="señal" o bind:modelValue="valor"`. Pasa la señal o el valor, o haz el modelo opcional con `defineModel<string>({ default: "" })`. Un valor que admite `undefined` no basta para un modelo obligatorio.

```html good
<AppInput label="Nombre" model="name" />
<AppInput label="Nombre" bind:modelValue="name.value" />
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

### Un modelo que el hijo no declara, o pasado de las dos formas

```html bad
<AppInput label="Nombre" model="name" model:opened="open" />
<AppInput label="Nombre" model="name" model:touched="touched" bind:touched="touched.value" />
```

`meeko check` da `TS2353: Object literal may only specify known properties, and '"opened"' does not exist in type 'ComponentModels'.` y `MEEK066: model:touched y bind:touched pasan los dos el modelo touched; deja model:touched, que comparte la señal, o bind:touched, que pasa el valor`.

```html good
<AppInput label="Nombre" model="name" model:touched="touched" />
```

### Declarar también su prop

```html bad
<script lang="ts">
const props = defineProps<{ modelValue: string }>();
const value = defineModel<string>();
</script>
```

`MEEK063: modelValue ya es de defineModel<T>(): el padre pasa bind:modelValue y on:update:modelValue, y el hijo lee y escribe el modelo; quítalo de defineProps`.

```html good
<script lang="ts">
const value = defineModel<string>();
</script>
```

## Notas

- **Estado y SSR.** La señal del padre pertenece al padre: no forma parte del estado que el hijo transfiere en SSR ni del que conserva HMR. El SSR lee su valor y la hidratación conecta la misma señal. Una señal local creada con `default` sí es estado del hijo; la que sigue a una prop, no.
- **Al cambiar de señal.** Si el padre pasa otra señal en un `model`, el hijo se vuelve a montar, conservando sus señales editables por nombre.
- **Dónde va.** En su propia declaración `const` de nivel superior con un nombre simple, una vez por nombre de modelo (`MEEK063`), antes del primer `await` de navegador (`MEEK058`).
- **Leer una prop en `default`.** `defineModel<string>({ default: props.initial ?? "" })` lee la prop una vez a propósito, así que no da `MEEK101`.
- **Formularios.** Dentro del hijo, el modelo se enlaza a un control con `model="value"`; el padre no necesita escuchar ningún evento.
