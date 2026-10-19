CREATE TABLE `submission_receipts` (
	`submission_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`actor_user_id`, `submission_id`),
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "submission_receipts_entity_type_check" CHECK(`entity_type` in ('post', 'comment'))
);
--> statement-breakpoint
CREATE INDEX `idx_submission_receipts_created_at` ON `submission_receipts` (`created_at`);
