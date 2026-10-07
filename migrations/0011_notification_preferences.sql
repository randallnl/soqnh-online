ALTER TABLE `users` ADD `mention_email_enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `weekly_digest_enabled` integer DEFAULT 1 NOT NULL;
