CREATE TABLE `site_memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_memberships_user_id_uidx` ON `site_memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `site_memberships_role_idx` ON `site_memberships` (`role`);--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`name` text,
	`avatar_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_provider_subject_uidx` ON `user_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `user_identities_user_idx` ON `user_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text DEFAULT '星屿管理员' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `posts` ADD `author_id` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `created_by` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `updated_by` integer;--> statement-breakpoint
-- Ownership base: a single site owner gets id 1 together with its local identity
-- and membership, then historical articles are attributed to it as a merge.
INSERT INTO `users` (`id`, `display_name`, `status`) VALUES (1, '星屿管理员', 'active')
  ON CONFLICT(`id`) DO NOTHING;--> statement-breakpoint
INSERT INTO `user_identities` (`user_id`, `provider`, `subject`, `name`)
  VALUES (1, 'local', 'owner', '星屿管理员')
  ON CONFLICT(`provider`, `subject`) DO NOTHING;--> statement-breakpoint
INSERT INTO `site_memberships` (`user_id`, `role`) VALUES (1, 'owner')
  ON CONFLICT(`user_id`) DO NOTHING;--> statement-breakpoint
UPDATE `posts` SET `author_id` = 1, `created_by` = 1, `updated_by` = 1
  WHERE `author_id` IS NULL;