import { prismaClient, decrypt, encrypt, needsReEncryption } from "@crm/database";

async function rotateKeys() {
  console.log("[rotate-keys] Starting encryption key rotation...");

  const newKey = process.env.FERNET_KEY || process.env.ENCRYPTION_KEY;
  if (!newKey) {
    console.error("[rotate-keys] FERNET_KEY or ENCRYPTION_KEY must be set");
    process.exit(1);
  }

  const oldKey = process.env.OLD_FERNET_KEY;
  if (!oldKey) {
    console.log("[rotate-keys] No OLD_FERNET_KEY set. Will re-encrypt with current key (re-salting).");
  }

  let rotated = 0;
  let skipped = 0;
  let failed = 0;

  const inboxes = await prismaClient.connectedInbox.findMany({
    select: { id: true, smtpPassEncrypted: true, imapPassEncrypted: true },
  });

  for (const inbox of inboxes) {
    try {
      const updates: Record<string, string> = {};

      if (needsReEncryption(inbox.smtpPassEncrypted)) {
        updates.smtpPassEncrypted = encrypt(decrypt(inbox.smtpPassEncrypted));
      }

      if (needsReEncryption(inbox.imapPassEncrypted)) {
        updates.imapPassEncrypted = encrypt(decrypt(inbox.imapPassEncrypted));
      }

      if (Object.keys(updates).length > 0) {
        await prismaClient.connectedInbox.update({
          where: { id: inbox.id },
          data: updates,
        });
        rotated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[rotate-keys] Failed to rotate inbox ${inbox.id}:`, err);
      failed++;
    }
  }

  console.log(`[rotate-keys] Rotation complete: ${rotated} rotated, ${skipped} skipped, ${failed} failed`);

  if (oldKey) {
    console.log("[rotate-keys] After verifying all values are re-encrypted, remove OLD_FERNET_KEY from env.");
  }

  await prismaClient.$disconnect();
}

rotateKeys().catch((err) => {
  console.error("[rotate-keys] Fatal error:", err);
  process.exit(1);
});
