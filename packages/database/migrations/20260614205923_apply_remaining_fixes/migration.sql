-- DropIndex
DROP INDEX "pipeline_stages_workspace_id_sort_order_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN "current_workspace_id" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_communication_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "connected_inbox_id" TEXT,
    "campaign_id" TEXT,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body_text" TEXT NOT NULL,
    "sent_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentiment" TEXT,
    "message_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "communication_history_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "communication_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "communication_history_connected_inbox_id_fkey" FOREIGN KEY ("connected_inbox_id") REFERENCES "connected_inboxes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "communication_history_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_communication_history" ("body_text", "campaign_id", "channel", "connected_inbox_id", "direction", "id", "is_read", "lead_id", "message_id", "sent_at", "sentiment", "subject", "workspace_id") SELECT "body_text", "campaign_id", "channel", "connected_inbox_id", "direction", "id", "is_read", "lead_id", "message_id", "sent_at", "sentiment", "subject", "workspace_id" FROM "communication_history";
DROP TABLE "communication_history";
ALTER TABLE "new_communication_history" RENAME TO "communication_history";
CREATE INDEX "communication_history_workspace_id_direction_idx" ON "communication_history"("workspace_id", "direction");
CREATE INDEX "communication_history_workspace_id_lead_id_idx" ON "communication_history"("workspace_id", "lead_id");
CREATE INDEX "communication_history_sent_at_idx" ON "communication_history"("sent_at");
CREATE INDEX "communication_history_workspace_id_campaign_id_idx" ON "communication_history"("workspace_id", "campaign_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "pipeline_stages_workspace_id_sort_order_idx" ON "pipeline_stages"("workspace_id", "sort_order");
