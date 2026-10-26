// Derives the site's images from the repository logo (assets/brand/meeko-logo.png), the single
// source of the brand: a favicon, an Apple touch icon and a light WebP for the pages. They are
// written to public/brand/, which is ignored by Git, and only when the logo is newer.
import { mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(site, "..", "assets", "brand", "meeko-logo.png");
const output = join(site, "public", "brand");

const targets = [
  { file: "favicon-64.png", size: 64, format: "png" },
  { file: "apple-touch-icon.png", size: 180, format: "png" },
  { file: "meeko-logo.webp", size: 320, format: "webp" },
];

async function modified(file) {
  try { return (await stat(file)).mtimeMs; }
  catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

const logo = await modified(source);
if (logo === undefined) throw new Error(`Missing the Meeko logo at ${source}`);
await mkdir(output, { recursive: true });
for (const target of targets) {
  const file = join(output, target.file);
  const current = await modified(file);
  if (current !== undefined && current >= logo) continue;
  const image = sharp(source).resize(target.size, target.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  await (target.format === "webp" ? image.webp({ quality: 86 }) : image.png({ compressionLevel: 9 })).toFile(file);
  console.log(`assets: ${target.file}`);
}
