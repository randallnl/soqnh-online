ALTER TABLE `users` ADD `support_email_enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `notifications_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_user_id` text,
	`post_id` text,
	`comment_id` text,
	`target_url` text,
	`type` text NOT NULL,
	`body` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_type_check" CHECK("notifications_new"."type" in ('comment', 'mention', 'approval', 'support', 'moderation', 'membership', 'directory'))
);
--> statement-breakpoint
INSERT INTO `notifications_new` (`id`, `user_id`, `actor_user_id`, `post_id`, `comment_id`, `target_url`, `type`, `body`, `read_at`, `created_at`)
SELECT `id`, `user_id`, `actor_user_id`, `post_id`, `comment_id`, NULL, `type`, `body`, `read_at`, `created_at` FROM `notifications`;
--> statement-breakpoint
DROP TABLE `notifications`;
--> statement-breakpoint
ALTER TABLE `notifications_new` RENAME TO `notifications`;
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read_created` ON `notifications` (`user_id`,`read_at`,`created_at` desc);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notifications_support_actor_post` ON `notifications` (`user_id`,`actor_user_id`,`post_id`,`type`) WHERE `type` = 'support';
--> statement-breakpoint
PRAGMA defer_foreign_keys = off;
