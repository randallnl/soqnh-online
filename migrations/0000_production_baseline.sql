CREATE TABLE `affiliations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `affiliations_name_unique` ON `affiliations` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `affiliations_slug_unique` ON `affiliations` (`slug`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text,
	`comment_id` text,
	`uploaded_by_user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attachments_parent_check" CHECK(("attachments"."post_id" is not null and "attachments"."comment_id" is null) or ("attachments"."post_id" is null and "attachments"."comment_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_object_key_unique` ON `attachments` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_attachments_post_id` ON `attachments` (`post_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_entity` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "auth_tokens_purpose_check" CHECK("auth_tokens"."purpose" in ('login', 'invite'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_token_hash_unique` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_tokens_email` ON `auth_tokens` (`email`);--> statement-breakpoint
CREATE INDEX `idx_auth_tokens_expires_at` ON `auth_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`parent_comment_id` text,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comments_status_check" CHECK("comments"."status" in ('published', 'hidden', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `idx_comments_post_id_created_at` ON `comments` (`post_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`post_id` text PRIMARY KEY NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`location_name` text,
	`location_url` text,
	`registration_url` text,
	`source_url` text,
	`external_url` text,
	`external_id` text,
	`scraped_at` text,
	`image_url` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_external_id` ON `events` (`external_id`) WHERE "events"."external_id" is not null;--> statement-breakpoint
CREATE INDEX `idx_events_starts_at` ON `events` (`starts_at`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`organization_id` text,
	`invited_role` text DEFAULT 'viewer' NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by_user_id` text,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invitations_invited_role_check" CHECK("invitations"."invited_role" in ('viewer', 'contributor', 'org_admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_user_id` text,
	`post_id` text,
	`comment_id` text,
	`type` text NOT NULL,
	`body` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_type_check" CHECK("notifications"."type" in ('comment', 'mention', 'approval'))
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read_created` ON `notifications` (`user_id`,`read_at`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `organization_affiliations` (
	`organization_id` text NOT NULL,
	`affiliation_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`organization_id`, `affiliation_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`affiliation_id`) REFERENCES `affiliations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_organization_affiliations_affiliation_id` ON `organization_affiliations` (`affiliation_id`);--> statement-breakpoint
CREATE TABLE `organization_memberships` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_memberships_role_check" CHECK("organization_memberships"."role" in ('viewer', 'contributor', 'org_admin'))
);
--> statement-breakpoint
CREATE INDEX `idx_memberships_user_id` ON `organization_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`summary` text,
	`description` text,
	`website_url` text,
	`contact_email` text,
	`logo_object_key` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`event_source_url` text,
	`event_parser` text,
	`event_scraping_enabled` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "organizations_status_check" CHECK("organizations"."status" in ('active', 'inactive', 'archived')),
	CONSTRAINT "organizations_event_scraping_enabled_check" CHECK("organizations"."event_scraping_enabled" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `post_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text,
	`comment_id` text,
	`mentioned_user_id` text NOT NULL,
	`mentioned_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mentioned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mentioned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_mentions_parent_check" CHECK(("post_mentions"."post_id" is not null and "post_mentions"."comment_id" is null) or ("post_mentions"."post_id" is null and "post_mentions"."comment_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_post_mentions_mentioned_user` ON `post_mentions` (`mentioned_user_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `post_reactions` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reaction` text DEFAULT 'support' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`, `reaction`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_reactions_reaction_check" CHECK("post_reactions"."reaction" in ('support'))
);
--> statement-breakpoint
CREATE INDEX `idx_post_reactions_user_id` ON `post_reactions` (`user_id`);--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`post_id`, `tag`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`author_user_id` text NOT NULL,
	`section` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`visibility` text DEFAULT 'members' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "posts_section_check" CHECK("posts"."section" in ('legislation', 'event', 'project', 'update')),
	CONSTRAINT "posts_visibility_check" CHECK("posts"."visibility" in ('members', 'organization')),
	CONSTRAINT "posts_status_check" CHECK("posts"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `idx_posts_section_created_at` ON `posts` (`section`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_posts_organization_id` ON `posts` (`organization_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`post_id` text PRIMARY KEY NOT NULL,
	`project_status` text DEFAULT 'planning' NOT NULL,
	`lead_organization_id` text,
	`target_date` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "projects_project_status_check" CHECK("projects"."project_status" in ('planning', 'active', 'paused', 'completed'))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_affiliations` (
	`user_id` text NOT NULL,
	`affiliation_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `affiliation_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`affiliation_id`) REFERENCES `affiliations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_affiliations_affiliation_id` ON `user_affiliations` (`affiliation_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`avatar_object_key` text,
	`site_role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text,
	`profile_title` text,
	`pronouns` text,
	`bio` text,
	`location` text,
	`website_url` text,
	`profile_visibility` text DEFAULT 'members' NOT NULL,
	CONSTRAINT "users_site_role_check" CHECK("users"."site_role" in ('member', 'site_admin')),
	CONSTRAINT "users_status_check" CHECK("users"."status" in ('invited', 'active', 'suspended')),
	CONSTRAINT "users_profile_visibility_check" CHECK("users"."profile_visibility" in ('members', 'hidden'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_profile_visibility` ON `users` (`profile_visibility`,`name`);--> statement-breakpoint
CREATE TABLE `video_embeds` (
	`post_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`source_url` text NOT NULL,
	`video_id` text,
	`title` text,
	`author_name` text,
	`author_url` text,
	`thumbnail_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "video_embeds_provider_check" CHECK("video_embeds"."provider" in ('tiktok'))
);
--> statement-breakpoint
CREATE INDEX `idx_video_embeds_provider_created_at` ON `video_embeds` (`provider`,"created_at" desc);