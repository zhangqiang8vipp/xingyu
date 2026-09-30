CREATE TRIGGER `posts_history_slug_guard_insert` AFTER INSERT ON `posts`
WHEN EXISTS (SELECT 1 FROM `post_slug_history` WHERE `slug` = NEW.`slug` AND `post_id` <> NEW.`id`)
BEGIN SELECT RAISE(ABORT, 'slug reserved by another post history'); END;--> statement-breakpoint
CREATE TRIGGER `posts_history_slug_guard_update` AFTER UPDATE OF `slug` ON `posts`
WHEN EXISTS (SELECT 1 FROM `post_slug_history` WHERE `slug` = NEW.`slug` AND `post_id` <> NEW.`id`)
BEGIN SELECT RAISE(ABORT, 'slug reserved by another post history'); END;--> statement-breakpoint
CREATE TRIGGER `history_current_slug_guard_insert` AFTER INSERT ON `post_slug_history`
WHEN EXISTS (SELECT 1 FROM `posts` WHERE `slug` = NEW.`slug` AND `id` <> NEW.`post_id`)
BEGIN SELECT RAISE(ABORT, 'historical slug conflicts with another current post'); END;--> statement-breakpoint
CREATE TRIGGER `history_current_slug_guard_update` AFTER UPDATE OF `slug`, `post_id` ON `post_slug_history`
WHEN EXISTS (SELECT 1 FROM `posts` WHERE `slug` = NEW.`slug` AND `id` <> NEW.`post_id`)
BEGIN SELECT RAISE(ABORT, 'historical slug conflicts with another current post'); END;
