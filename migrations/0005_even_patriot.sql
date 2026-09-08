ALTER TABLE `users` ADD `profile_completed_at` text;--> statement-breakpoint
UPDATE `users`
SET `profile_completed_at` = CURRENT_TIMESTAMP
WHERE `status` = 'active';
