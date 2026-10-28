// Encrypts Shopify client secrets and access tokens at rest (D-14, D-11).
// AES-256-GCM, random 96-bit IV per value. Format: v1.<iv>.<tag>.<ciphertext> (base64url).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoConfigError';
  }
}

export function parseKey(base64: string | undefined): Buffer {
  if (!base64) throw new CryptoConfigError('ENCRYPTION_KEY is not set');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new CryptoConfigError('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

const b64u = (b: Buffer) => b.toString('base64url');

export function encryptSecret(plain: string, key: Buffer = parseKey(process.env.ENCRYPTION_KEY)): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join('.');
}

export function decryptSecret(blob: string, key: Buffer = parseKey(process.env.ENCRYPTION_KEY)): string {
  const [version, iv, tag, ct] = blob.split('.');
  // ct may legitimately be an empty string (empty plaintext), so test for undefined only.
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
