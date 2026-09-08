ALTER TABLE `organizations` ADD `directory_status` text DEFAULT 'not_listed' NOT NULL CHECK (`directory_status` in ('not_listed', 'pending', 'published', 'rejected', 'opted_out'));--> statement-breakpoint
ALTER TABLE `organizations` ADD `directory_requested_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `organizations` ADD `directory_requested_at` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `directory_reviewed_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `organizations` ADD `directory_reviewed_at` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `directory_review_note` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `directory_published_at` text;--> statement-breakpoint
CREATE INDEX `idx_organizations_directory_status_name` ON `organizations` (`directory_status`,`name`);
