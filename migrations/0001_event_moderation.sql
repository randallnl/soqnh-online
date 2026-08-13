ALTER TABLE `events` ADD `moderation_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `reviewed_by_user_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `reviewed_at` text;--> statement-breakpoint
ALTER TABLE `events` ADD `rejection_reason` text;--> statement-breakpoint
UPDATE `events`
SET `moderation_status` = 'approved'
WHERE `post_id` IN (SELECT `id` FROM `posts` WHERE `status` = 'published');--> statement-breakpoint
CREATE INDEX `idx_events_moderation_status` ON `events` (`moderation_status`);
