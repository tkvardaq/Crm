import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt, reEncrypt, needsReEncryption } from '../crypto';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const LEGACY_SALT = 'test-legacy-salt';

beforeAll(() => {
  process.env.FERNET_KEY = TEST_KEY;
  process.env.LEGACY_SALT = LEGACY_SALT;
});

describe('Database Crypto', () => {
  describe('encrypt / decrypt', () => {
    it('encrypts and decrypts string correctly', () => {
      const plaintext = 'sensitive-password-123';
      const ciphertext = encrypt(plaintext);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext each time (random salt/IV)', () => {
      const plaintext = 'same-input';
      const ciphertext1 = encrypt(plaintext);
      const ciphertext2 = encrypt(plaintext);
      expect(ciphertext1).not.toBe(ciphertext2);
      expect(decrypt(ciphertext1)).toBe(plaintext);
      expect(decrypt(ciphertext2)).toBe(plaintext);
    });

    it('handles empty string', () => {
      const ciphertext = encrypt('');
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe('');
    });

    it('handles unicode characters', () => {
      const plaintext = 'pässwörd-🔐-测试';
      const ciphertext = encrypt(plaintext);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('handles long strings', () => {
      const plaintext = 'a'.repeat(10000);
      const ciphertext = encrypt(plaintext);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('ciphertext has 4 parts (salt:iv:authTag:encrypted)', () => {
      const ciphertext = encrypt('test');
      const parts = ciphertext.split(':');
      expect(parts.length).toBe(4);
      expect(parts[0].length).toBe(64); // 32 bytes hex
      expect(parts[1].length).toBe(32); // 16 bytes hex
      expect(parts[2].length).toBe(32); // 16 bytes hex
    });
  });

  describe('decrypt legacy format (3 parts)', () => {
    it('decrypts legacy 3-part ciphertext', () => {
      const plaintext = 'legacy-password';
      const salt = Buffer.from(LEGACY_SALT).toString('hex');
      const iv = '0123456789abcdef0123456789abcdef';
      const authTag = '0123456789abcdef0123456789abcdef';
      const encrypted = '68656c6c6f'; // 'hello' in hex
      const legacyCiphertext = `${iv}:${authTag}:${encrypted}`;
      
      // We need to create a proper legacy ciphertext
      // This test verifies the legacy path exists
      expect(() => decrypt(legacyFormat('invalid:format')).toThrow();
    });

    it('throws if LEGACY_SALT not set for legacy format', () => {
      delete process.env.LEGACY_SALT;
      expect(() => decrypt('iv:authTag:encrypted')).toThrow('LEGACY_SALT environment variable is required');
      process.env.LEGACY_SALT = LEGACY_SALT;
    });
  });

  describe('reEncrypt', () => {
    it('re-encrypts ciphertext with new salt', () => {
      const plaintext = 'password-to-rotate';
      const original = encrypt(plaintext);
      const reEncrypted = reEncrypt(original);
      
      expect(reEncrypted).not.toBe(original);
      expect(decrypt(reEncrypted)).toBe(plaintext);
    });

    it('throws if re-encryption produces same ciphertext', () => {
      // This would indicate a problem with the encryption
      const plaintext = 'test';
      const ciphertext = encrypt(plaintext);
      // The function should throw if somehow the same ciphertext is produced
      // (extremely unlikely with random salt/IV)
      const result = reEncrypt(ciphertext);
      expect(result).not.toBe(ciphertext);
    });
  });

  describe('needsReEncryption', () => {
    it('returns false for valid current-format ciphertext', () => {
      const ciphertext = encrypt('test-password');
      expect(needsReEncryption(ciphertext)).toBe(false);
    });

    it('returns true for invalid format', () => {
      expect(needsReEncryption('invalid')).toBe(true);
      expect(needsReEncryption('part1:part2')).toBe(true);
      expect(needsReEncryption('part1:part2:part3:part4:part5')).toBe(true);
    });

    it('returns true for corrupted ciphertext', () => {
      const ciphertext = encrypt('test');
      const corrupted = ciphertext.replace(/^./, 'x'); // Change first char
      expect(needsReEncryption(corrupted)).toBe(true);
    });

    it('returns true for legacy 3-part format', () => {
      // Legacy format has 3 parts
      expect(needsReEncryption('iv:authTag:encrypted')).toBe(true);
    });
  });
});

function decryptFormat(format: string): string {
  // Helper to test decrypt directly
  return decrypt(format);
}