ALTER TABLE `attachments` ADD `unbound_at` text;--> statement-breakpoint
-- Backfill: pre-existing unbound rows inherit their creation time as the
-- start of the unbound clock; bound rows stay NULL until detached.
UPDATE `attachments` SET `unbound_at` = `created_at` WHERE `post_id` IS NULL AND `unbound_at` IS NULL;