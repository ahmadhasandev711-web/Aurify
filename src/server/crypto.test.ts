import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoConfigError, decryptSecret, encryptSecret, parseKey } from './crypto';

const key = randomBytes(32);

describe('secret encryption', () => {
  it('round-trips, including unicode', () => {
    for (const s of ['shpss_abc123', 'سر المتجر ✓', '']) {
      expect(decryptSecret(encryptSecret(s, key), key)).toBe(s);
    }
  });

  it('uses a fresh IV, so the same value encrypts differently each time', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key));
  });

  it('never contains the plaintext', () => {
    expect(encryptSecret('my-secret-token', key)).not.toContain('my-secret-token');
  });

  it('fails with the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('x', key), randomBytes(32))).toThrow();
  });

  it('detects tampering', () => {
    const [v, iv, tag, ct] = encryptSecret('hello', key).split('.');
    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64url')].join('.'), key)).toThrow();
  });

  it('rejects unknown formats', () => {
    expect(() => decryptSecret('plain-text', key)).toThrow('Unsupported ciphertext format');
  });
});

describe('parseKey', () => {
  it('requires a 32-byte base64 key', () => {
    expect(() => parseKey(undefined)).toThrow(CryptoConfigError);
    expect(() => parseKey(randomBytes(16).toString('base64'))).toThrow(CryptoConfigError);
    expect(parseKey(randomBytes(32).toString('base64'))).toHaveLength(32);
  });
});
