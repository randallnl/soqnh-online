CREATE TABLE `public_spotlights` (
	`id` text PRIMARY KEY NOT NULL,
	`eyebrow` text,
	`headline` text NOT NULL,
	`message` text NOT NULL,
	`image_object_key` text NOT NULL,
	`image_alt` text NOT NULL,
	`photo_credit` text,
	`primary_button_label` text,
	`primary_button_url` text,
	`secondary_button_label` text,
	`secondary_button_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 0 NOT NULL,
	`created_by_user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT `public_spotlights_is_active_check` CHECK (`is_active` in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_public_spotlights_active_order` ON `public_spotlights` (`is_active`,`sort_order`,`created_at`);
