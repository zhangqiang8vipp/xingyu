import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { scryptSync } from "node:crypto";

export const PASSWORD_SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

// OWASP's 32 MiB scrypt profile. Native scrypt avoids the deployed PBKDF2 cap
// and the CPU cost of a JavaScript KDF on restricted Worker plans.
export function deriveScryptPasswordKey(password: string, salt: Uint8Array) {
  return new Uint8Array(scryptSync(password, salt, 32, PASSWORD_SCRYPT_OPTIONS));
}

// Workers' deployed native crypto caps PBKDF2 at 100,000 iterations,
// unlike local workerd. Preserve the persisted format and full work factor.
export async function derivePasswordKey(password: string, salt: Uint8Array, iterations: number) {
  if (!Number.isSafeInteger(iterations) || iterations < 210_000 || iterations > 1_000_000) {
    throw new RangeError("Unsupported password work factor");
  }
  return pbkdf2Async(sha256, new TextEncoder().encode(password), salt, {
    c: iterations, dkLen: 32, asyncTick: 10,
  });
}
