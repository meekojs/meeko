---
title: meeko auth hash
group: commands
since: 1.2.0
description: Pide una contraseña sin mostrarla, o la lee de stdin, e imprime su hash scrypt para guardarlo en .env o en la base de datos.
symbols:
  - "cli:auth hash"
related:
  - "@meekojs/meeko/password#hashPassword"
  - "@meekojs/meeko/password#verifyPassword"
  - "@meekojs/meeko/password#needsRehash"
  - docs/framework.md#contraseñas
  - docs/framework.md#autenticación
---

`meeko auth hash` calcula el hash de una contraseña con [`hashPassword`](/docs/reference/hashpassword), el mismo que comprueba [`verifyPassword`](/docs/reference/verifypassword), sin escribir código. En una terminal la pide dos veces sin mostrarla; con una tubería, la lee de stdin. Es la forma de crear la contraseña de un administrador inicial o de una cuenta de servicio sin que el texto quede en el historial de la shell.

Sólo el hash va a la salida estándar, en una línea: `meeko auth hash >> .env` o una tubería reciben una línea limpia. Las preguntas y los errores van a la salida de errores.

## Uso

```sh
meeko auth hash
```

```text
Contraseña:
Repite la contraseña:
scrypt$131072$8$1$qDDk4lEVlBfPaPUR69yHaw$WegdhAqKv_T2cKoowsGNBSNXPMZt64Cqj8fl29xngxQ
```

## Parámetros

| Entrada | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| Terminal (stdin es un TTY) | texto, sin eco | | Pide `Contraseña:` y `Repite la contraseña:`. Retroceso borra; `Ctrl+C`, o `Ctrl+D` con la línea vacía, cancela. Se ignoran los caracteres de control y las secuencias de escape (flechas, pegado entre corchetes). |
| Tubería (stdin no es un TTY) | texto | | Lee toda la entrada y quita un único salto de línea final (`\n` o `\r\n`). Debe ser una sola línea. |

El comando no admite opciones: `meeko auth` sin `hash` da `Falta el subcomando de auth: meeko auth hash`, y otro subcomando, `Subcomando desconocido de auth: …`.

## Resultado

Una línea `scrypt$<N>$<r>$<p>$<sal>$<hash>` en la salida estándar y código `0`. Los parámetros son los actuales de `hashPassword`: N = 2^17, r = 8 y p = 1, una sal aleatoria de 16 bytes y una clave de 32, en base64url. Cada ejecución da un hash distinto para la misma contraseña, por la sal.

| Error | Mensaje | Código |
| --- | --- | --- |
| Las dos entradas no coinciden | `Las contraseñas no coinciden` | `1` |
| Contraseña vacía en la terminal | `La contraseña está vacía` | `1` |
| Contraseña vacía por tubería | `La contraseña está vacía` (hasta `1.6`, `The password is empty`) | `1` |
| Más de una línea por tubería | `La entrada debe tener una sola línea con la contraseña` | `1` |
| Más de 4096 bytes | `La contraseña supera 4096 bytes` (hasta `1.6`, `The password exceeds 4096 bytes`) | `1` |
| Cancelado | `Cancelado` | `1` |

## Ejemplos

### Añadirlo al `.env`

```sh
printf 'ADMIN_PASSWORD_HASH=' >> .env
meeko auth hash >> .env
```

Las preguntas siguen apareciendo en la terminal, porque van a la salida de errores. El `.env` queda con `ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…`; Meeko lo lee sin expandir los `$`.

### Desde una variable, en CI o un script

```sh
printf '%s' "$ADMIN_PASSWORD" | npx meeko auth hash
```

En PowerShell:

```powershell
$env:ADMIN_PASSWORD | npx meeko auth hash
```

`printf '%s'` no añade salto de línea; `echo` sí, y el comando quita uno, así que los dos valen.

### Comprobarlo en el inicio de sesión

<!-- no-check -->
```ts
// server/api/login.post.ts
import { verifyPassword } from "@meekojs/meeko/password";
import { Login, LoginResult } from "../../shared/schemas";

export default defineApiRoute({
  body: Login,
  response: LoginResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  async handler({ body, context }) {
    const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? "");
    if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.session.create({ user: body.username });
    return { ok: true };
  },
});
```

## Errores comunes

### Pegar el hash sin comillas en la shell

```sh bad
export ADMIN_PASSWORD_HASH=scrypt$131072$8$1$jQXb_TSxcrlRUin1zqwB5A$VWVZOYuDzu9hjDwIlyBxBLriaJAn8Lj62IsGDeSRj24
```

La shell expande `$1`, `$8` y el resto como variables: la variable queda en `scrypt31072`, y `verifyPassword` lanza `TypeError: Invalid password hash: expected scrypt$<N>$<r>$<p>$<salt>$<hash> within Meeko's limits`. Pasa igual con `$` en un `docker-compose.yml`, que también interpola.

```sh good
export ADMIN_PASSWORD_HASH='scrypt$131072$8$1$jQXb_TSxcrlRUin1zqwB5A$VWVZOYuDzu9hjDwIlyBxBLriaJAn8Lj62IsGDeSRj24'
```

En un `.env` de Meeko no hacen falta comillas: no expande variables.

### Varias líneas por la tubería

```sh bad
printf 'secreto\notra\n' | meeko auth hash
```

`La entrada debe tener una sola línea con la contraseña`. El comando no recorta espacios ni toma la primera línea: lo que llega es la contraseña.

```sh good
printf '%s' 'secreto' | meeko auth hash
```

### Escribir la contraseña como argumento

```sh bad
meeko auth hash secreto
```

`Argumento de más para auth: secreto`, con el uso y código `1`. Un argumento quedaría en el historial de la shell y en la lista de procesos; por eso no existe.

```sh good
meeko auth hash
```

## Notas

- **Seguridad.** La contraseña nunca va a la salida estándar ni a los argumentos. En la terminal no hay eco; con `printf '%s' "$VAR"`, la variable sí puede quedar en el historial si la escribes literal en la línea de comandos.
- **Coste.** Cada hash ocupa 128 MiB durante el cálculo y tarda una fracción de segundo; es lo esperado de scrypt con estos parámetros.
- **Dónde funciona.** Se ejecuta con Node; el hash sirve en cualquier runtime que tenga `@meekojs/meeko/password` (Node, Bun, Deno). Cloudflare Workers no tiene memoria suficiente para verificarlo.
- **Windows.** En PowerShell, `$env:VAR | meeko auth hash` envía la línea con su salto de línea, que el comando quita (`\n` o `\r\n`). En `cmd`, `echo secreto | meeko auth hash` incluye el espacio antes de `|` en la contraseña (`"secreto "`): escribe `echo secreto| meeko auth hash`.
- **Rehash.** Si algún día cambian los parámetros por defecto, los hashes antiguos siguen siendo válidos; `needsRehash(hash)` dice cuándo conviene recalcularlo tras un inicio de sesión correcto.
