// SDK
// Designed & Built By onyxpowered.

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export const DEFAULT_SCRYPT_PARAMS = Object.freeze({ N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });

export function generateKey() {
  return randomBytes(KEY_LENGTH);
}

export function generateSalt() {
  return randomBytes(16);
}

export function deriveKeyFromPassphrase(passphrase, salt, params = DEFAULT_SCRYPT_PARAMS) {
  return scryptSync(passphrase, salt, KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function encrypt(key, plaintextBuffer) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, authTag, ciphertext };
}

export function decrypt(key, { iv, authTag, ciphertext }) {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
