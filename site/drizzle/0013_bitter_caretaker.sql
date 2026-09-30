CREATE TABLE `attachment_cleanup_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text,
	`object_key` text NOT NULL,
	`operation` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_cleanup_queue_object_key_uidx` ON `attachment_cleanup_queue` (`object_key`);--> statement-breakpoint
CREATE INDEX `attachment_cleanup_queue_status_idx` ON `attachment_cleanup_queue` (`status`,`created_at`,`id`);