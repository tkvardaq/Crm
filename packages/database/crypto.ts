import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const LEGACY_SALT = process.env.LEGACY_SALT;

function validateEncryptionKey(): void {
  const key = process.env.FERNET_KEY || process.env.ENCRYPTION_KEY;
  if (!key) {
    console.error("[crypto] FERNET_KEY or ENCRYPTION_KEY is not set. Encryption will fail.");
    return;
  }
  if (key.startsWith("replace_") || key.length < 32) {
    console.error("[crypto] FERNET_KEY appears to be a placeholder or too short. Please set a proper 64-char hex key.");
  }
}

validateEncryptionKey();

function getEncryptionKey(salt: Buffer): Buffer {
	const fernetKey = process.env.FERNET_KEY || process.env.ENCRYPTION_KEY;
	if (!fernetKey) {
		throw new Error("FERNET_KEY or ENCRYPTION_KEY environment variable is required");
	}
	return scryptSync(fernetKey, salt, 32);
}

export function reEncrypt(ciphertext: string): string {
  const plaintext = decrypt(ciphertext);
  const reEncrypted = encrypt(plaintext);
  if (reEncrypted === ciphertext) {
    throw new Error("Re-encryption produced the same ciphertext — check encryption key");
  }
  return reEncrypted;
}

export function needsReEncryption(ciphertext: string): boolean {
  const parts = ciphertext.split(":");
  if (parts.length < 3 || parts.length > 4) return true;
  try {
    decrypt(ciphertext);
    return false;
  } catch {
    return true;
  }
}

export function encrypt(plaintext: string): string {
	const salt = randomBytes(SALT_LENGTH);
	const key = getEncryptionKey(salt);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	let encrypted = cipher.update(plaintext, "utf8", "hex");
	encrypted += cipher.final("hex");
	const authTag = cipher.getAuthTag().toString("hex");
	return `${salt.toString("hex")}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
	const parts = ciphertext.split(":");
	let salt: Buffer;
	let iv: Buffer;
	let authTag: Buffer;
	let encrypted: string;

	if (parts.length === 4) {
		salt = Buffer.from(parts[0], "hex");
		iv = Buffer.from(parts[1], "hex");
		authTag = Buffer.from(parts[2], "hex");
		encrypted = parts[3];
	} else if (parts.length === 3) {
		if (!LEGACY_SALT) {
			throw new Error("LEGACY_SALT environment variable is required to decrypt legacy ciphertexts");
		}
		salt = scryptSync(
			process.env.FERNET_KEY || process.env.ENCRYPTION_KEY || "",
			LEGACY_SALT,
			32
		);
		iv = Buffer.from(parts[0], "hex");
		authTag = Buffer.from(parts[1], "hex");
		encrypted = parts[2];
	} else {
		throw new Error("Invalid ciphertext format");
	}

	const key = Buffer.isBuffer(salt) && parts.length === 4
		? getEncryptionKey(salt)
		: salt;
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);
	let decrypted = decipher.update(encrypted, "hex", "utf8");
	decrypted += decipher.final("utf8");
	return decrypted;
}
