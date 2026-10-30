import { existsSync, realpathSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const dist = resolve(packageRoot, "dist");
if (dirname(dist) !== packageRoot) throw new Error("Refusing to clean dist outside the Meeko package");
if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
