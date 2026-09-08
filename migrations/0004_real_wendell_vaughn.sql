CREATE TABLE `organization_membership_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`requested_role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` text,
	`review_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "organization_membership_claims_role_check" CHECK("organization_membership_claims"."requested_role" in ('viewer', 'contributor', 'org_admin')),
	CONSTRAINT "organization_membership_claims_status_check" CHECK("organization_membership_claims"."status" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_organization_membership_claims_pending` ON `organization_membership_claims` (`organization_id`,`user_id`) WHERE "organization_membership_claims"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `idx_organization_membership_claims_user_created` ON `organization_membership_claims` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_organization_membership_claims_org_status` ON `organization_membership_claims` (`organization_id`,`status`,"created_at" desc);