ALTER TABLE `posts` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `posts_space_sort_idx` ON `posts` (`space_id`,`sort_order`,`id`);