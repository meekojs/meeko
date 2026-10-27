import { readFileSync, writeFileSync } from "node:fs";

const [archivePath, executablePath] = process.argv.slice(2);
if (!archivePath || !executablePath) throw new Error("Indica el VSIX y la ruta del ejecutable interno.");

const archive = readFileSync(archivePath);
const endSignature = 0x06054b50;
const directorySignature = 0x02014b50;
let end = -1;
for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset--) {
  if (archive.readUInt32LE(offset) === endSignature && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length) {
    end = offset;
    break;
  }
}
if (end < 0) throw new Error("No se encontró el directorio ZIP del VSIX.");

const entries = archive.readUInt16LE(end + 10);
let offset = archive.readUInt32LE(end + 16);
if (entries === 0xffff || offset === 0xffffffff) throw new Error("El VSIX usa ZIP64, formato no admitido por este ajuste.");

let matches = 0;
for (let index = 0; index < entries; index++) {
  if (archive.readUInt32LE(offset) !== directorySignature) throw new Error("El directorio ZIP del VSIX está dañado.");
  const nameLength = archive.readUInt16LE(offset + 28);
  const extraLength = archive.readUInt16LE(offset + 30);
  const commentLength = archive.readUInt16LE(offset + 32);
  const name = archive.toString("utf8", offset + 46, offset + 46 + nameLength);
  if (name === executablePath) {
    const attributes = archive.readUInt32LE(offset + 38);
    archive.writeUInt32LE(((attributes & ~0x01ff0000) | 0x01ed0000) >>> 0, offset + 38);
    matches++;
  }
  offset += 46 + nameLength + extraLength + commentLength;
}
if (matches !== 1) throw new Error(`Se encontraron ${matches} entradas para ${executablePath}; se esperaba una.`);
writeFileSync(archivePath, archive);
