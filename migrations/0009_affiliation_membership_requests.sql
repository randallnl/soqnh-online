CREATE TABLE `affiliation_membership_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` text,
	`review_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`affiliation_id`) REFERENCES `affiliations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "affiliation_membership_requests_status_check" CHECK(`status` in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_affiliation_membership_requests_pending` ON `affiliation_membership_requests` (`affiliation_id`,`user_id`) WHERE `status` = 'pending';
--> statement-breakpoint
CREATE INDEX `idx_affiliation_membership_requests_user_created` ON `affiliation_membership_requests` (`user_id`,`created_at` desc);
--> statement-breakpoint
CREATE INDEX `idx_affiliation_membership_requests_status_created` ON `affiliation_membership_requests` (`status`,`created_at`);
