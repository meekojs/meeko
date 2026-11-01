---
title: meeko auth hash
group: commands
since: 1.2.0
description: Prompts for a password without echoing it, or reads it from stdin, and prints its scrypt hash for storage in .env or the database.
symbols:
  - "cli:auth hash"
related:
  - "@meekojs/meeko/password#hashPassword"
  - "@meekojs/meeko/password#verifyPassword"
  - "@meekojs/meeko/password#needsRehash"
  - docs/framework.md#contraseñas
  - docs/framework.md#autenticación
source-hash: 347dd57f0cfa7f32587759ae4a2a02821ce637b7ea33716f30394639beb2dfe8
---

`meeko auth hash` hashes a password with [`hashPassword`](/en/docs/reference/hashpassword), the same hash checked by [`verifyPassword`](/en/docs/reference/verifypassword), without writing code. In a terminal it prompts twice without echoing; with a pipe, it reads stdin. Use it to create an initial administrator's or service account's password without leaving plaintext in shell history.

Only the hash goes to standard output, on one line: `meeko auth hash >> .env` or a pipe receives a clean line. Prompts and errors go to standard error.

## Usage

```sh
meeko auth hash
```

```text
Contraseña:
Repite la contraseña:
scrypt$131072$8$1$qDDk4lEVlBfPaPUR69yHaw$WegdhAqKv_T2cKoowsGNBSNXPMZt64Cqj8fl29xngxQ
```

## Parameters

| Input                     | Type               | Default | Description                                                                                                                                                                                                |
| ------------------------- | ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal (stdin is a TTY) | text, without echo |         | Prompts with `Contraseña:` and `Repite la contraseña:`. Backspace deletes; `Ctrl+C`, or `Ctrl+D` on an empty line, cancels. Control characters and escape sequences (arrows, bracketed paste) are ignored. |
| Pipe (stdin is not a TTY) | text               |         | Reads all input and removes a single trailing newline (`\n` or `\r\n`). Must be a single line.                                                                                                             |

The command accepts no options: `meeko auth` without `hash` produces `Falta el subcomando de auth: meeko auth hash`, and another subcommand produces `Subcomando desconocido de auth: …`.

## Result

A line `scrypt$<N>$<r>$<p>$<sal>$<hash>` on standard output and exit code `0`. Parameters are the current `hashPassword` defaults: N = 2^17, r = 8 and p = 1, a random 16-byte salt and a 32-byte key, in base64url. Each run produces a different hash for the same password because of the salt.

| Error                             | Message                                                                              | Code |
| --------------------------------- | ------------------------------------------------------------------------------------ | ---- |
| The two inputs do not match       | `Las contraseñas no coinciden`                                                       | `1`  |
| Empty password in the terminal    | `La contraseña está vacía`                                                           | `1`  |
| Empty password through a pipe     | `La contraseña está vacía` (through `1.6`, `The password is empty`)                  | `1`  |
| More than one line through a pipe | `La entrada debe tener una sola línea con la contraseña`                             | `1`  |
| More than 4096 bytes              | `La contraseña supera 4096 bytes` (through `1.6`, `The password exceeds 4096 bytes`) | `1`  |
| Canceled                          | `Cancelado`                                                                          | `1`  |

## Examples

### Add it to `.env`

```sh
printf 'ADMIN_PASSWORD_HASH=' >> .env
meeko auth hash >> .env
```

Prompts still appear in the terminal because they go to standard error. The `.env` ends up with `ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…`; Meeko reads it without expanding `$`.

### From a variable, in CI or a script

```sh
printf '%s' "$ADMIN_PASSWORD" | npx meeko auth hash
```

In PowerShell:

```powershell
$env:ADMIN_PASSWORD | npx meeko auth hash
```

`printf '%s'` does not add a newline; `echo` does, and the command removes one, so both work.

### Verify it at sign-in

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

## Common mistakes

### Paste the hash unquoted into the shell

```sh bad
export ADMIN_PASSWORD_HASH=scrypt$131072$8$1$jQXb_TSxcrlRUin1zqwB5A$VWVZOYuDzu9hjDwIlyBxBLriaJAn8Lj62IsGDeSRj24
```

The shell expands `$1`, `$8` and the rest as variables: the variable becomes `scrypt31072`, and `verifyPassword` throws `TypeError: Invalid password hash: expected scrypt$<N>$<r>$<p>$<salt>$<hash> within Meeko's limits`. The same happens with `$` in a `docker-compose.yml`, which also interpolates.

```sh good
export ADMIN_PASSWORD_HASH='scrypt$131072$8$1$jQXb_TSxcrlRUin1zqwB5A$VWVZOYuDzu9hjDwIlyBxBLriaJAn8Lj62IsGDeSRj24'
```

In a Meeko `.env`, quotes are unnecessary: it does not expand variables.

### Multiple lines through the pipe

```sh bad
printf 'secreto\notra\n' | meeko auth hash
```

`La entrada debe tener una sola línea con la contraseña`. The command does not trim spaces or take the first line: whatever arrives is the password.

```sh good
printf '%s' 'secreto' | meeko auth hash
```

### Write the password as an argument

```sh bad
meeko auth hash secreto
```

`Argumento de más para auth: secreto`, with usage and exit code `1`. An argument would remain in shell history and the process list; this is why it does not exist.

```sh good
meeko auth hash
```

## Notes

- **Security.** The password never goes to standard output or arguments. There is no terminal echo; with `printf '%s' "$VAR"`, the variable can remain in history if you type it literally on the command line.
- **Cost.** Each hash uses 128 MiB during computation and takes a fraction of a second; this is expected for scrypt with these parameters.
- **Supported environments.** Runs in Node; the hash works in any runtime with `@meekojs/meeko/password` (Node, Bun, Deno). Cloudflare Workers does not have enough memory to verify it.
- **Windows.** In PowerShell, `$env:VAR | meeko auth hash` sends the line with its newline, which the command removes (`\n` or `\r\n`). In `cmd`, `echo secreto | meeko auth hash` includes the space before `|` in the password (`"secreto "`): write `echo secreto| meeko auth hash`.
- **Rehashing.** If defaults change in the future, old hashes remain valid; `needsRehash(hash)` tells you when to recompute after a successful sign-in.
