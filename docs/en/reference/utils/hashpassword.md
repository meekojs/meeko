---
title: hashPassword
group: utils
since: 1.2.0
description: Computes a password's scrypt hash in a self-describing format, ready to store in a column or .env.
symbols:
  - "@meekojs/meeko/password#hashPassword"
related:
  - "@meekojs/meeko/password#verifyPassword"
  - "@meekojs/meeko/password#needsRehash"
  - "cli:auth hash"
  - "@meekojs/meeko/server#SessionManager"
  - docs/framework.md#contraseñas
  - docs/framework.md#autenticación
source-hash: c2fa1df195a1b9c80b29d26d9cbe2a571ac237a2678f44f8a79c0e1ddaa14780
---

`hashPassword(password)` hashes a password with scrypt (N = 2^17, r = 8, p = 1, a random 16-byte salt and a 32-byte key) and returns it in the self-describing format `scrypt$<N>$<r>$<p>$<sal>$<hash>`, with the salt and hash in base64url. Store the result as is: in a column, or in `.env` for an administration account.

Import it from `@meekojs/meeko/password`, only on the server. It uses `node:crypto`, so it works in Node, Bun and Deno, not in Cloudflare Workers.

## Usage

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

## Parameters

| Parameter  | Type     | Default  | Description                                            |
| ---------- | -------- | -------- | ------------------------------------------------------ |
| `password` | `string` | required | The plaintext password, from 1 to 4096 bytes in UTF-8. |

## Return value

A promise with the hash, such as `scrypt$131072$8$1$<sal>$<hash>` (84 characters with the current parameters). Each call uses a new salt, so the same password produces different hashes: always compare them with `verifyPassword`, never with `===`.

Throws:

- `TypeError: The password must be a string` if it is not a string;
- `RangeError: The password is empty` for an empty string;
- `RangeError: The password exceeds 4096 bytes` above the limit.

## Examples

### The administration password in `.env`

For a single account, without a database, the hash goes in an environment variable. `meeko auth hash` computes it without displaying the password:

```sh
npx meeko auth hash                          # la pide dos veces, sin mostrarla
printf '%s' "$PASSWORD" | npx meeko auth hash  # o la lee de stdin
```

```sh
# .env (no versionado)
ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…
```

### Change the password

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

## Common mistakes

### Use it in a component

```html bad
<script lang="ts">
import { hashPassword } from "@meekojs/meeko/password";
</script>
```

`meeko check` warns with `MEEK109: @meekojs/meeko/password sólo funciona en el servidor: el <script> y la plantilla de un componente también se ejecutan en el navegador, donde sus funciones fallan. Mueve ese código a <script server> o a server/; para usar sus tipos, impórtalos con import type. Desde 2.0 será un error`.

<!-- no-check -->

```ts good
// server/api/signup.post.ts
import { hashPassword } from "@meekojs/meeko/password";
```

### Compare hashes with `===`

```ts bad
const ok = (await hashPassword(input.password)) === user.passwordHash; // siempre false
```

The salt is random: two hashes of the same password never match, and the comparison is not constant-time.

<!-- no-check -->

```ts good
const ok = await verifyPassword(input.password, user.passwordHash);
```

### An empty or overly long password

```ts bad
await hashPassword("");
```

`RangeError: The password is empty` (and `The password exceeds 4096 bytes` above the limit). Validate the length in the input schema, so the user receives a `400` with its message.

<!-- no-check -->

```ts good
const signupInput = v.object({ password: v.pipe(v.string(), v.minLength(12, "Usa al menos 12 caracteres."), v.maxLength(1024)) });
```

## Notes

- **Cost.** Each hash allocates 128 MiB of memory and takes on the order of hundreds of milliseconds. Meeko computes at most two concurrently per process; protect endpoints using it with `rateLimit`.
- **Security.** Never log or return the password. The hash is safe to store, but not to publish: treat it as a secret.
- **Runtimes.** Not available in Cloudflare Workers, which does not have `node:crypto` with scrypt.
- **Parameters.** If a future version increases the cost, `needsRehash` tells you which hashes to recompute after a successful login.
