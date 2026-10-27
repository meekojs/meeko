import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// `@meekojs/meeko/password` needs `node:crypto`: Web Crypto has no memory-hard password hash, so
// this entry is separate from the portable `./server`. Node, Bun and Deno provide `node:crypto`.

/** Default cost: scrypt with N = 2^17, r = 8, p = 1 (128 MiB per hash), a 16-byte salt and a 32-byte key. */
const defaults = { cost: 2 ** 17, blockSize: 8, parallelization: 1, saltBytes: 16, keyBytes: 32 } as const;

/** Limits of a stored hash, so a mistyped configuration cannot exhaust memory. */
const limits = { minCost: 2 ** 10, maxCost: 2 ** 20, maxBlockSize: 32, maxParallelization: 16, maxMemory: 2 ** 30, minSaltBytes: 8, minKeyBytes: 16, maxKeyBytes: 128 } as const;

/** Passwords are measured in UTF-8 bytes; longer ones are refused before any work. */
const maxPasswordBytes = 4096;

/** Derivations allowed at the same time: each one holds 128 MiB with the default cost. */
const maxConcurrentHashes = 2;

interface ParsedHash {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}

const format = /^scrypt\$(\d{1,8})\$(\d{1,3})\$(\d{1,3})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function decode(value: string): Buffer | undefined {
  const bytes = Buffer.from(value, "base64url");
  // Only the canonical unpadded encoding is accepted: one stored value, one meaning.
  return bytes.toString("base64url") === value ? bytes : undefined;
}

function parse(hash: unknown): ParsedHash | undefined {
  if (typeof hash !== "string") return undefined;
  const match = format.exec(hash);
  if (!match) return undefined;
  const cost = Number(match[1]);
  const blockSize = Number(match[2]);
  const parallelization = Number(match[3]);
  const salt = decode(match[4]!);
  const key = decode(match[5]!);
  if (!salt || !key) return undefined;
  if (cost < limits.minCost || cost > limits.maxCost || (cost & (cost - 1)) !== 0) return undefined;
  if (blockSize < 1 || blockSize > limits.maxBlockSize || parallelization < 1 || parallelization > limits.maxParallelization) return undefined;
  if (128 * cost * blockSize > limits.maxMemory) return undefined;
  if (salt.length < limits.minSaltBytes || key.length < limits.minKeyBytes || key.length > limits.maxKeyBytes) return undefined;
  return { cost, blockSize, parallelization, salt, key };
}

function passwordBytes(password: unknown): Buffer {
  if (typeof password !== "string") throw new TypeError("The password must be a string");
  const bytes = Buffer.from(password, "utf8");
  if (bytes.length === 0) throw new RangeError("The password is empty");
  if (bytes.length > maxPasswordBytes) throw new RangeError(`The password exceeds ${maxPasswordBytes} bytes`);
  return bytes;
}

let running = 0;
const waiting: Array<() => void> = [];

/** Runs one derivation once fewer than `maxConcurrentHashes` are in flight. */
async function derive(password: Buffer, parameters: Omit<ParsedHash, "key">, keyBytes: number): Promise<Buffer> {
  if (running >= maxConcurrentHashes) await new Promise<void>((resume) => waiting.push(resume));
  running++;
  try {
    return await new Promise<Buffer>((resolveKey, reject) => {
      scrypt(password, parameters.salt, keyBytes, {
        N: parameters.cost, r: parameters.blockSize, p: parameters.parallelization,
        // Node requires 128 * N * r bytes for the working set, plus the block buffers.
        maxmem: 128 * parameters.cost * parameters.blockSize + 128 * parameters.blockSize * parameters.parallelization + 1024 * 1024,
      }, (error, key) => error ? reject(error) : resolveKey(key));
    });
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * Calcula el hash de una contraseña con scrypt (N = 2^17, r = 8, p = 1, sal aleatoria de 16 bytes y
 * clave de 32 bytes) en el formato autodescriptivo `scrypt$<N>$<r>$<p>$<sal>$<hash>`, con la sal y el
 * hash en base64url. El resultado se guarda tal cual, por ejemplo en `.env` o en una columna.
 * Requiere `node:crypto` (Node, Bun y Deno); no está disponible en Cloudflare Workers.
 *
 * Como mucho se calculan dos hashes a la vez en el proceso: cada uno reserva 128 MiB.
 *
 * @param password Contraseña en texto, de 1 a 4096 bytes en UTF-8.
 * @returns El hash.
 * @throws {TypeError} Si `password` no es una cadena.
 * @throws {RangeError} Si la contraseña está vacía o supera 4096 bytes.
 * @since 1.2.0
 * @example
 * ```ts
 * import { hashPassword } from "@meekojs/meeko/password";
 *
 * const passwordHash = await hashPassword(input.password);
 * await db.insert(users).values({ email: input.email, passwordHash });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#autenticación
 */
export async function hashPassword(password: string): Promise<string> {
  const bytes = passwordBytes(password);
  const salt = randomBytes(defaults.saltBytes);
  const parameters = { cost: defaults.cost, blockSize: defaults.blockSize, parallelization: defaults.parallelization, salt };
  const key = await derive(bytes, parameters, defaults.keyBytes);
  return `scrypt$${defaults.cost}$${defaults.blockSize}$${defaults.parallelization}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/**
 * Comprueba una contraseña contra un hash `scrypt$<N>$<r>$<p>$<sal>$<hash>`, el de
 * {@link hashPassword} o uno escrito antes con esos mismos parámetros (como
 * `scrypt$131072$8$1$…` con una sal de 32 bytes y un hash de 64). Recalcula el hash con los
 * parámetros guardados y compara en tiempo constante. Una contraseña vacía o de más de 4096 bytes
 * devuelve `false` sin calcular nada.
 *
 * Para no revelar qué cuentas existen, cuando el usuario no existe compare igualmente contra un
 * hash fijo antes de responder.
 *
 * @param password Contraseña recibida.
 * @param hash Hash guardado.
 * @returns `true` si coincide.
 * @throws {TypeError} Si `hash` no tiene el formato o sus parámetros están fuera de los límites
 * (N potencia de dos entre 2^10 y 2^20, `r` hasta 32, `p` hasta 16): es un fallo de configuración,
 * no una contraseña incorrecta.
 * @since 1.2.0
 * @example
 * ```ts
 * import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
 * import { verifyPassword } from "@meekojs/meeko/password";
 *
 * export default defineApiRoute({
 *   body: loginInput,
 *   response: okResult,
 *   handler: async ({ body, context }) => {
 *     const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? "");
 *     if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError("INVALID_CREDENTIALS", 401);
 *     await context.session.create({ user: body.username, role: "owner" });
 *     return { ok: true as const };
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#autenticación
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parsed = parse(hash);
  if (!parsed) throw new TypeError("Invalid password hash: expected scrypt$<N>$<r>$<p>$<salt>$<hash> within Meeko's limits");
  let bytes: Buffer;
  try { bytes = passwordBytes(password); }
  catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
  const key = await derive(bytes, parsed, parsed.key.length);
  return timingSafeEqual(key, parsed.key);
}

/**
 * Indica si un hash debe recalcularse con los parámetros actuales de {@link hashPassword}: su coste,
 * su sal o su clave son menores, o no tiene un formato válido. Úselo tras un inicio de sesión
 * correcto para actualizar el hash guardado con la contraseña que acaba de comprobarse.
 *
 * @param hash Hash guardado.
 * @returns `true` si conviene guardar un hash nuevo.
 * @since 1.2.0
 * @example
 * ```ts
 * import { hashPassword, needsRehash, verifyPassword } from "@meekojs/meeko/password";
 *
 * if (await verifyPassword(input.password, user.passwordHash) && needsRehash(user.passwordHash)) {
 *   await db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, user.id));
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#autenticación
 */
export function needsRehash(hash: string): boolean {
  const parsed = parse(hash);
  if (!parsed) return true;
  return parsed.cost < defaults.cost || parsed.blockSize < defaults.blockSize || parsed.parallelization < defaults.parallelization
    || parsed.salt.length < defaults.saltBytes || parsed.key.length < defaults.keyBytes;
}
