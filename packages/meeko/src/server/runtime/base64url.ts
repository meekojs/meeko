const base64UrlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url, identical to Node's encoding, without depending on Buffer. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    output += base64UrlAlphabet[value >> 18]! + base64UrlAlphabet[(value >> 12) & 63]! + base64UrlAlphabet[(value >> 6) & 63]! + base64UrlAlphabet[value & 63]!;
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const value = bytes[index]! << 16;
    output += base64UrlAlphabet[value >> 18]! + base64UrlAlphabet[(value >> 12) & 63]!;
  } else if (remaining === 2) {
    const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8);
    output += base64UrlAlphabet[value >> 18]! + base64UrlAlphabet[(value >> 12) & 63]! + base64UrlAlphabet[(value >> 6) & 63]!;
  }
  return output;
}
