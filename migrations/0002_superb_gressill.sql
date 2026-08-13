CREATE TABLE `scraper_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`organization_id` text,
	`post_id` text,
	`external_id` text,
	`outcome` text NOT NULL,
	`title` text,
	`starts_at` text,
	`source_url` text,
	`reason` text,
	`payload_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `scraper_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "scraper_imports_outcome_check" CHECK("scraper_imports"."outcome" in ('imported', 'updated', 'duplicate', 'invalid'))
);
--> statement-breakpoint
CREATE INDEX `idx_scraper_imports_run_id` ON `scraper_imports` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_scraper_imports_organization_created_at` ON `scraper_imports` (`organization_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_scraper_imports_external_id` ON `scraper_imports` (`external_id`);--> statement-breakpoint
CREATE TABLE `scraper_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_type` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`initiated_by_user_id` text,
	`partners_count` integer DEFAULT 0 NOT NULL,
	`scraped_count` integer DEFAULT 0 NOT NULL,
	`submitted_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`result_json` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`initiated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "scraper_runs_trigger_type_check" CHECK("scraper_runs"."trigger_type" in ('manual', 'callback')),
	CONSTRAINT "scraper_runs_status_check" CHECK("scraper_runs"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_scraper_runs_started_at` ON `scraper_runs` ("started_at" desc);
