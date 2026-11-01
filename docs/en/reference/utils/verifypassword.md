---
title: verifyPassword
group: utils
since: 1.2.0
description: Checks a password against a stored scrypt hash in constant time, recomputing it with the hash's own parameters.
symbols:
  - "@meekojs/meeko/password#verifyPassword"
related:
  - "@meekojs/meeko/password#hashPassword"
  - "@meekojs/meeko/password#needsRehash"
  - "@meekojs/meeko/server#defineRpc"
  - "cli:auth hash"
  - docs/framework.md#contraseñas
  - docs/framework.md#autenticación
source-hash: 2eb7e918bb8e411fab88824cc029ad113a7132b3aac2ae9748a3a1bd3dd91519
---

`verifyPassword(password, hash)` checks a password against a `scrypt$<N>$<r>$<p>$<sal>$<hash>` hash: one from `hashPassword` or an older one with parameters within Meeko's limits. It recomputes the hash with the stored parameters and compares it in constant time.

Import it from `@meekojs/meeko/password`, only on the server (Node, Bun and Deno).

## Usage

<!-- no-check -->

```ts
// server/rpc/auth/login.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { verifyPassword } from "@meekojs/meeko/password";
import { loginInput, loginOutput } from "../../../shared/schemas/auth";

const DUMMY_HASH = "scrypt$131072$8$1$…"; // un hash cualquiera, calculado una vez con meeko auth hash

export default defineRpc({
  input: loginInput,
  output: loginOutput,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ input, context }) => {
    const user = await context.services.db.users.byEmail(input.email);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.session.create({ userId: user.id });
    return { ok: true };
  },
});
```

Comparing against a fixed hash when the user does not exist makes the response take the same time, without revealing which email addresses have an account.

## Parameters

| Parameter  | Type     | Default  | Description            |
| ---------- | -------- | -------- | ---------------------- |
| `password` | `string` | required | The received password. |
| `hash`     | `string` | required | The stored hash.       |

## Return value

A promise with `true` if the password matches and `false` otherwise. An empty password or one exceeding 4096 bytes returns `false` without computing anything.

Throws `TypeError: Invalid password hash: expected scrypt$<N>$<r>$<p>$<salt>$<hash> within Meeko's limits` if the hash has the wrong format or its parameters are outside the limits (N a power of two between 2^10 and 2^20, `r` up to 32, `p` up to 16). This is a configuration failure, not an incorrect password.

## Examples

### An administration account in `.env`

<!-- no-check -->

```ts
// server/api/admin/login.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { verifyPassword } from "@meekojs/meeko/password";
import { adminLogin, okResult } from "../../../shared/schemas/admin";

export default defineApiRoute({
  origin: "required",
  rateLimit: { limit: 5, window: "15m" },
  body: adminLogin,
  response: okResult,
  handler: async ({ body, context }) => {
    const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? "");
    if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.session.create({ user: body.username, role: "owner" });
    return { ok: true as const };
  },
});
```

If `ADMIN_PASSWORD_HASH` is missing, `verifyPassword` throws `TypeError` for the empty hash: the configuration failure appears on the first attempt, instead of silently rejecting every password.

### Update the hash after login

<!-- no-check -->

```ts
if (await verifyPassword(input.password, user.passwordHash)) {
  if (needsRehash(user.passwordHash)) {
    await db.users.update(user.id, { passwordHash: await hashPassword(input.password) });
  }
}
```

## Common mistakes

### A hash in another format

```ts bad
await verifyPassword(input.password, "$2b$10$…"); // un hash de bcrypt
```

`TypeError: Invalid password hash: expected scrypt$<N>$<r>$<p>$<salt>$<hash> within Meeko's limits`. Migrate those accounts by verifying with their library and storing a new hash with `hashPassword` after the next login.

<!-- no-check -->

```ts good
const valid = user.passwordHash.startsWith("scrypt$")
  ? await verifyPassword(input.password, user.passwordHash)
  : await bcrypt.compare(input.password, user.passwordHash);
```

### Respond differently if the user does not exist

Returning early when there is no user makes the response faster and reveals which email addresses have an account, without any error.

```ts bad
const user = await findUser(input.email);
if (!user) throw new ApiError("UNKNOWN_EMAIL", 404);
```

<!-- no-check -->

```ts good
const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
if (!user || !valid) throw new ApiError("INVALID_CREDENTIALS", 401);
```

### Expect it to throw for an incorrect password

`verifyPassword` only throws for a malformed hash: an incorrect, empty or overly long password returns `false`.

```ts bad
try { await verifyPassword(input.password, hash); } catch { throw new ApiError("INVALID_CREDENTIALS", 401); }
```

<!-- no-check -->

```ts good
if (!(await verifyPassword(input.password, hash))) throw new ApiError("INVALID_CREDENTIALS", 401);
```

## Notes

- **Security.** Limit attempts with `rateLimit` and require `origin: "required"` on login. Rotate the session on login (`session.create` creates a new one).
- **Cost.** Each check costs the same as a `hashPassword`: about 128 MiB and hundreds of milliseconds.
- **Runtimes.** Only in Node, Bun and Deno; in a component, the import warns with `MEEK109`.
