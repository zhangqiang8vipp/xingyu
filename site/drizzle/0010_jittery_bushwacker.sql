CREATE TABLE `admin_login_attempts` (
	`identifier` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started` integer NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `posts_public_id_required_insert` BEFORE INSERT ON `posts`
  WHEN new.public_id IS NULL OR new.public_id = '' BEGIN
  SELECT RAISE(ABORT, 'posts.public_id is required');
END;
--> statement-breakpoint
CREATE TRIGGER `posts_public_id_required_update` BEFORE UPDATE OF public_id ON `posts`
  WHEN new.public_id IS NULL OR new.public_id = '' BEGIN
  SELECT RAISE(ABORT, 'posts.public_id is required');
END;
--> statement-breakpoint
INSERT INTO `public_cache_state` (`id`, `revision`) VALUES (1, 1);
--> statement-breakpoint
CREATE TRIGGER `public_cache_posts_insert` AFTER INSERT ON `posts`
  WHEN new.status='published' AND new.space_id IS NULL BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_posts_delete` AFTER DELETE ON `posts`
  WHEN old.status='published' AND old.space_id IS NULL BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_posts_update` AFTER UPDATE OF title,slug,excerpt,content,category_id,space_id,status,featured,published_at ON `posts`
  WHEN (old.status='published' AND old.space_id IS NULL) OR (new.status='published' AND new.space_id IS NULL) BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_categories_insert` AFTER INSERT ON `categories` BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_categories_update` AFTER UPDATE ON `categories` BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_categories_delete` AFTER DELETE ON `categories` BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_settings_update` AFTER UPDATE ON `site_settings` BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_pages_insert` AFTER INSERT ON `content_pages` BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_pages_update` AFTER UPDATE ON `content_pages` BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER `public_cache_pages_delete` AFTER DELETE ON `content_pages` BEGIN
  UPDATE public_cache_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
