/**
 * Le vrai type d'un fichier, lu dans ses premiers octets.
 * Le type annoncé par le navigateur vient du client : un fichier HTML déclaré
 * « image/png » était accepté, enregistré, puis resservi. Fonctionne sur un
 * Buffer côté serveur comme sur un Uint8Array dans le navigateur.
 */
export type TypeImage = "image/jpeg" | "image/png" | "image/webp";

export const EXTENSION_IMAGE: Record<TypeImage, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (b: Uint8Array, debut: number, fin: number) => String.fromCharCode(...b.subarray(debut, fin));

export function typeImage(buf: Uint8Array): TypeImage | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (PNG.every((o, i) => buf[i] === o)) return "image/png";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";
  return null;
}
