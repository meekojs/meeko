---
title: needsRehash
group: utils
since: 1.2.0
description: Indicates whether a password hash needs recalculating with the current hashPassword parameters, to update it after a successful login.
symbols:
  - "@meekojs/meeko/password#needsRehash"
related:
  - "@meekojs/meeko/password#hashPassword"
  - "@meekojs/meeko/password#verifyPassword"
  - docs/framework.md#contraseñas
source-hash: 0bb52b12accae9fe935a3ad32f6f5fd33fc541c4d66f7c776b67d5115e46424c
---

`needsRehash(hash)` tells you whether a stored hash needs recalculating with the current `hashPassword` parameters: its cost (N, r, p), salt or key is smaller than the current values, or its format is invalid. It is synchronous and does not calculate any hash.

Use it immediately after a successful login: that is the only time the server has the plaintext password to calculate the new hash.

## Usage

<!-- no-check -->

```ts
import { hashPassword, needsRehash, verifyPassword } from "@meekojs/meeko/password";

if (await verifyPassword(input.password, user.passwordHash) && needsRehash(user.passwordHash)) {
  await db.users.update(user.id, { passwordHash: await hashPassword(input.password) });
}
```

## Parameters

| Parameter | Type     | Default  | Description      |
| --------- | -------- | -------- | ---------------- |
| `hash`    | `string` | required | The stored hash. |

## Return value

`true` if you should store a new hash; `false` if the hash already uses the current parameters (or larger ones). It never throws: text that is not a Meeko hash returns `true`.

| Hash                                                        | Result  |
| ----------------------------------------------------------- | ------- |
| From `hashPassword` in this version (`scrypt$131072$8$1$…`) | `false` |
| `scrypt$16384$8$1$…`, with a lower cost                     | `true`  |
| `bcrypt$…`, `$2b$10$…` or any other text                    | `true`  |

## Examples

### In the login procedure

<!-- no-check -->

```ts
// server/rpc/auth/login.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { hashPassword, needsRehash, verifyPassword } from "@meekojs/meeko/password";
import { loginInput, loginOutput } from "../../../shared/schemas/auth";

export default defineRpc({
  input: loginInput,
  output: loginOutput,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ input, context }) => {
    const user = await context.services.db.users.byEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new ApiError("INVALID_CREDENTIALS", 401);
    if (needsRehash(user.passwordHash)) {
      context.platform.waitUntil(hashPassword(input.password).then((passwordHash) => context.services.db.users.update(user.id, { passwordHash })));
    }
    await context.session.create({ userId: user.id });
    return { ok: true };
  },
});
```

`waitUntil` lets the new hash be calculated and stored without delaying the response.

### Checking how many accounts remain to migrate

```ts
import { needsRehash } from "@meekojs/meeko/password";

export function pendingRehash(hashes: readonly string[]): number {
  return hashes.filter(needsRehash).length;
}
```

## Common mistakes

### Recalculating without verification

Without `verifyPassword`, the new hash would be calculated from an unchecked password: anyone could change another account's password, without any error.

```ts bad
if (needsRehash(user.passwordHash)) await save(user.id, await hashPassword(input.password));
```

<!-- no-check -->

```ts good
if (await verifyPassword(input.password, user.passwordHash) && needsRehash(user.passwordHash)) await save(user.id, await hashPassword(input.password));
```

### Calling it with `await` expecting a promise

`needsRehash` is synchronous. An `await` is unnecessary but does not fail; the mistake is treating its result as a promise.

```ts bad
needsRehash(hash).then((stale) => stale && rehash());
```

`meeko check` reports `TS2339: Property 'then' does not exist on type 'boolean'.`

<!-- no-check -->

```ts good
if (needsRehash(hash)) await rehash();
```

## Notes

- **Cost.** It calculates nothing: it reads the hash parameters. You can call it on every login.
- **Migrations.** With `verifyPassword` and another library for old hashes, `needsRehash` returns `true` for any non-Meeko hash, so the account migrates on its next login.
- **Runtimes.** Server only (Node, Bun and Deno), like the rest of `@meekojs/meeko/password`.
