---
title: hashPassword
group: utils
since: 1.2.0
description: Calcula el hash scrypt de una contraseña en un formato autodescriptivo, listo para guardarlo en una columna o en .env.
symbols:
  - "@meekojs/meeko/password#hashPassword"
related:
  - "@meekojs/meeko/password#verifyPassword"
  - "@meekojs/meeko/password#needsRehash"
  - "cli:auth hash"
  - "@meekojs/meeko/server#SessionManager"
  - docs/framework.md#contraseñas
  - docs/framework.md#autenticación
---

`hashPassword(password)` calcula el hash de una contraseña con scrypt (N = 2^17, r = 8, p = 1, una sal aleatoria de 16 bytes y una clave de 32 bytes) y lo devuelve en el formato autodescriptivo `scrypt$<N>$<r>$<p>$<sal>$<hash>`, con la sal y el hash en base64url. El resultado se guarda tal cual: en una columna, o en `.env` para una cuenta de administración.

Se importa de `@meekojs/meeko/password`, sólo en el servidor. Usa `node:crypto`, así que funciona en Node, Bun y Deno, no en Cloudflare Workers.

## Uso

<!-- no-check -->
```ts
// server/api/signup.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { hashPassword } from "@meekojs/meeko/password";
import { signupInput, signupResult } from "../../shared/schemas/signup";

export default defineApiRoute({
  origin: "required",
  rateLimit: { limit: 5, window: "10m" },
  body: signupInput,
  response: signupResult,
  status: 201,
  handler: async ({ body, context }) => {
    if (await context.services.db.users.exists(body.email)) throw new ApiError("EMAIL_TAKEN", 409);
    const passwordHash = await hashPassword(body.password);
    const user = await context.services.db.users.insert({ email: body.email, passwordHash });
    return { id: user.id };
  },
});
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `password` | `string` | obligatorio | La contraseña en texto, de 1 a 4096 bytes en UTF-8. |

## Valor devuelto

Una promesa con el hash, como `scrypt$131072$8$1$<sal>$<hash>` (84 caracteres con los parámetros actuales). Cada llamada usa una sal nueva, así que la misma contraseña da hashes distintos: compáralos siempre con `verifyPassword`, nunca con `===`.

Lanza:

- `TypeError: The password must be a string` si no es una cadena;
- `RangeError: The password is empty` con una cadena vacía;
- `RangeError: The password exceeds 4096 bytes` por encima del límite.

## Ejemplos

### La contraseña de administración en `.env`

Para una cuenta única, sin base de datos, el hash va en una variable de entorno. `meeko auth hash` lo calcula sin mostrar la contraseña:

```sh
npx meeko auth hash                          # la pide dos veces, sin mostrarla
printf '%s' "$PASSWORD" | npx meeko auth hash  # o la lee de stdin
```

```sh
# .env (no versionado)
ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…
```

### Cambiar la contraseña

<!-- no-check -->
```ts
// server/rpc/account/password.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { hashPassword, verifyPassword } from "@meekojs/meeko/password";
import { changePasswordInput, okOutput } from "../../../shared/schemas/account";

export default defineRpc({
  input: changePasswordInput,
  output: okOutput,
  auth: "required",
  handler: async ({ input, context }) => {
    const user = await context.services.db.users.find(context.session.current!.data.userId);
    if (!user || !(await verifyPassword(input.current, user.passwordHash))) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.services.db.users.update(user.id, { passwordHash: await hashPassword(input.next) });
    await context.session.rotate();
    return { ok: true };
  },
});
```

## Errores comunes

### Usarlo en un componente

```html bad
<script lang="ts">
import { hashPassword } from "@meekojs/meeko/password";
</script>
```

`meeko check` avisa con `MEEK109: @meekojs/meeko/password sólo funciona en el servidor: el <script> y la plantilla de un componente también se ejecutan en el navegador, donde sus funciones fallan. Mueve ese código a <script server> o a server/; para usar sus tipos, impórtalos con import type. Desde 2.0 será un error`.

<!-- no-check -->
```ts good
// server/api/signup.post.ts
import { hashPassword } from "@meekojs/meeko/password";
```

### Comparar hashes con `===`

```ts bad
const ok = (await hashPassword(input.password)) === user.passwordHash; // siempre false
```

La sal es aleatoria: dos hashes de la misma contraseña nunca coinciden, y la comparación no es de tiempo constante.

<!-- no-check -->
```ts good
const ok = await verifyPassword(input.password, user.passwordHash);
```

### Una contraseña vacía o demasiado larga

```ts bad
await hashPassword("");
```

`RangeError: The password is empty` (y `The password exceeds 4096 bytes` por encima del límite). Valida la longitud en el schema de la entrada, para que el usuario reciba un `400` con su mensaje.

<!-- no-check -->
```ts good
const signupInput = v.object({ password: v.pipe(v.string(), v.minLength(12, "Usa al menos 12 caracteres."), v.maxLength(1024)) });
```

## Notas

- **Coste.** Cada hash reserva 128 MiB de memoria y tarda del orden de cientos de milisegundos. Meeko calcula como mucho dos a la vez por proceso; protege los endpoints que lo usan con `rateLimit`.
- **Seguridad.** Nunca registres la contraseña ni la devuelvas. El hash es seguro de guardar, pero no de publicar: trátalo como un secreto.
- **Runtimes.** No está disponible en Cloudflare Workers, que no tiene `node:crypto` con scrypt.
- **Parámetros.** Si una versión futura sube el coste, `needsRehash` dirá qué hashes recalcular tras un inicio de sesión correcto.
