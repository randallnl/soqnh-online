import { desc, sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
	text("created_at")
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`);
const updatedAt = () =>
	text("updated_at")
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`);

export const users = sqliteTable(
	"users",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull().unique(),
		name: text("name"),
		avatarObjectKey: text("avatar_object_key"),
		siteRole: text("site_role", { enum: ["member", "site_admin"] })
			.notNull()
			.default("member"),
		status: text("status", { enum: ["invited", "active", "suspended"] })
			.notNull()
			.default("invited"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		lastSeenAt: text("last_seen_at"),
		profileTitle: text("profile_title"),
		pronouns: text("pronouns"),
		bio: text("bio"),
		location: text("location"),
		websiteUrl: text("website_url"),
		profileVisibility: text("profile_visibility", {
			enum: ["members", "hidden"],
		})
			.notNull()
			.default("members"),
	},
	(table) => [
		check(
			"users_site_role_check",
			sql`${table.siteRole} in ('member', 'site_admin')`,
		),
		check(
			"users_status_check",
			sql`${table.status} in ('invited', 'active', 'suspended')`,
		),
		check(
			"users_profile_visibility_check",
			sql`${table.profileVisibility} in ('members', 'hidden')`,
		),
		index("idx_users_profile_visibility").on(
			table.profileVisibility,
			table.name,
		),
	],
);

export const sessions = sqliteTable(
	"sessions",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: text("expires_at").notNull(),
		createdAt: createdAt(),
		revokedAt: text("revoked_at"),
	},
	(table) => [
		index("idx_sessions_user_id").on(table.userId),
		index("idx_sessions_expires_at").on(table.expiresAt),
	],
);

export const organizations = sqliteTable(
	"organizations",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique(),
		summary: text("summary"),
		description: text("description"),
		websiteUrl: text("website_url"),
		contactEmail: text("contact_email"),
		logoObjectKey: text("logo_object_key"),
		status: text("status", { enum: ["active", "inactive", "archived"] })
			.notNull()
			.default("active"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		eventSourceUrl: text("event_source_url"),
		eventParser: text("event_parser"),
		eventScrapingEnabled: integer("event_scraping_enabled")
			.notNull()
			.default(0),
	},
	(table) => [
		check(
			"organizations_status_check",
			sql`${table.status} in ('active', 'inactive', 'archived')`,
		),
		check(
			"organizations_event_scraping_enabled_check",
			sql`${table.eventScrapingEnabled} in (0, 1)`,
		),
	],
);

export const organizationMemberships = sqliteTable(
	"organization_memberships",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["viewer", "contributor", "org_admin"] })
			.notNull()
			.default("viewer"),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.userId] }),
		check(
			"organization_memberships_role_check",
			sql`${table.role} in ('viewer', 'contributor', 'org_admin')`,
		),
		index("idx_memberships_user_id").on(table.userId),
	],
);

export const invitations = sqliteTable(
	"invitations",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		organizationId: text("organization_id").references(
			() => organizations.id,
			{ onDelete: "set null" },
		),
		invitedRole: text("invited_role", {
			enum: ["viewer", "contributor", "org_admin"],
		})
			.notNull()
			.default("viewer"),
		tokenHash: text("token_hash").notNull().unique(),
		invitedByUserId: text("invited_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		expiresAt: text("expires_at").notNull(),
		acceptedAt: text("accepted_at"),
		createdAt: createdAt(),
	},
	(table) => [
		check(
			"invitations_invited_role_check",
			sql`${table.invitedRole} in ('viewer', 'contributor', 'org_admin')`,
		),
	],
);

export const posts = sqliteTable(
	"posts",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").references(
			() => organizations.id,
			{ onDelete: "set null" },
		),
		authorUserId: text("author_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		section: text("section", {
			enum: ["legislation", "event", "project", "update"],
		}).notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		visibility: text("visibility", {
			enum: ["members", "organization"],
		})
			.notNull()
			.default("members"),
		status: text("status", { enum: ["draft", "published", "archived"] })
			.notNull()
			.default("published"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		archivedAt: text("archived_at"),
	},
	(table) => [
		check(
			"posts_section_check",
			sql`${table.section} in ('legislation', 'event', 'project', 'update')`,
		),
		check(
			"posts_visibility_check",
			sql`${table.visibility} in ('members', 'organization')`,
		),
		check(
			"posts_status_check",
			sql`${table.status} in ('draft', 'published', 'archived')`,
		),
		index("idx_posts_section_created_at").on(
			table.section,
			desc(table.createdAt),
		),
		index("idx_posts_organization_id").on(table.organizationId),
	],
);

export const postTags = sqliteTable(
	"post_tags",
	{
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		tag: text("tag").notNull(),
	},
	(table) => [primaryKey({ columns: [table.postId, table.tag] })],
);

export const comments = sqliteTable(
	"comments",
	{
		id: text("id").primaryKey(),
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		parentCommentId: text("parent_comment_id").references(
			(): AnySQLiteColumn => comments.id,
			{ onDelete: "cascade" },
		),
		authorUserId: text("author_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		body: text("body").notNull(),
		status: text("status", { enum: ["published", "hidden", "archived"] })
			.notNull()
			.default("published"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		check(
			"comments_status_check",
			sql`${table.status} in ('published', 'hidden', 'archived')`,
		),
		index("idx_comments_post_id_created_at").on(
			table.postId,
			table.createdAt,
		),
	],
);

export const events = sqliteTable(
	"events",
	{
		postId: text("post_id")
			.primaryKey()
			.references(() => posts.id, { onDelete: "cascade" }),
		startsAt: text("starts_at").notNull(),
		endsAt: text("ends_at"),
		locationName: text("location_name"),
		locationUrl: text("location_url"),
		registrationUrl: text("registration_url"),
		sourceUrl: text("source_url"),
		externalUrl: text("external_url"),
		externalId: text("external_id"),
		scrapedAt: text("scraped_at"),
		imageUrl: text("image_url"),
		moderationStatus: text("moderation_status", {
			enum: ["pending", "approved", "rejected"],
		})
			.notNull()
			.default("pending"),
		reviewedByUserId: text("reviewed_by_user_id"),
		reviewedAt: text("reviewed_at"),
		rejectionReason: text("rejection_reason"),
	},
	(table) => [
		uniqueIndex("idx_events_external_id")
			.on(table.externalId)
			.where(sql`${table.externalId} is not null`),
		index("idx_events_starts_at").on(table.startsAt),
		index("idx_events_moderation_status").on(table.moderationStatus),
	],
);

export const scraperRuns = sqliteTable(
	"scraper_runs",
	{
		id: text("id").primaryKey(),
		triggerType: text("trigger_type", {
			enum: ["manual", "callback"],
		}).notNull(),
		status: text("status", {
			enum: ["running", "succeeded", "failed"],
		})
			.notNull()
			.default("running"),
		initiatedByUserId: text("initiated_by_user_id").references(
			() => users.id,
			{ onDelete: "set null" },
		),
		partnersCount: integer("partners_count").notNull().default(0),
		scrapedCount: integer("scraped_count").notNull().default(0),
		submittedCount: integer("submitted_count").notNull().default(0),
		importedCount: integer("imported_count").notNull().default(0),
		updatedCount: integer("updated_count").notNull().default(0),
		skippedCount: integer("skipped_count").notNull().default(0),
		failureCount: integer("failure_count").notNull().default(0),
		resultJson: text("result_json", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		errorMessage: text("error_message"),
		startedAt: text("started_at").notNull(),
		finishedAt: text("finished_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		check(
			"scraper_runs_trigger_type_check",
			sql`${table.triggerType} in ('manual', 'callback')`,
		),
		check(
			"scraper_runs_status_check",
			sql`${table.status} in ('running', 'succeeded', 'failed')`,
		),
		index("idx_scraper_runs_started_at").on(desc(table.startedAt)),
	],
);

export const scraperImports = sqliteTable(
	"scraper_imports",
	{
		id: text("id").primaryKey(),
		runId: text("run_id").references(() => scraperRuns.id, {
			onDelete: "set null",
		}),
		organizationId: text("organization_id").references(
			() => organizations.id,
			{ onDelete: "set null" },
		),
		postId: text("post_id").references(() => posts.id, {
			onDelete: "set null",
		}),
		externalId: text("external_id"),
		outcome: text("outcome", {
			enum: ["imported", "updated", "duplicate", "invalid"],
		}).notNull(),
		title: text("title"),
		startsAt: text("starts_at"),
		sourceUrl: text("source_url"),
		reason: text("reason"),
		payloadJson: text("payload_json", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		createdAt: createdAt(),
	},
	(table) => [
		check(
			"scraper_imports_outcome_check",
			sql`${table.outcome} in ('imported', 'updated', 'duplicate', 'invalid')`,
		),
		index("idx_scraper_imports_run_id").on(table.runId),
		index("idx_scraper_imports_organization_created_at").on(
			table.organizationId,
			desc(table.createdAt),
		),
		index("idx_scraper_imports_external_id").on(table.externalId),
	],
);

export const projects = sqliteTable("projects", {
	postId: text("post_id")
		.primaryKey()
		.references(() => posts.id, { onDelete: "cascade" }),
	projectStatus: text("project_status", {
		enum: ["planning", "active", "paused", "completed"],
	})
		.notNull()
		.default("planning"),
	leadOrganizationId: text("lead_organization_id").references(
		() => organizations.id,
		{ onDelete: "set null" },
	),
	targetDate: text("target_date"),
}, (table) => [
	check(
		"projects_project_status_check",
		sql`${table.projectStatus} in ('planning', 'active', 'paused', 'completed')`,
	),
]);

export const attachments = sqliteTable(
	"attachments",
	{
		id: text("id").primaryKey(),
		postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
		commentId: text("comment_id").references(() => comments.id, {
			onDelete: "cascade",
		}),
		uploadedByUserId: text("uploaded_by_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		objectKey: text("object_key").notNull().unique(),
		filename: text("filename").notNull(),
		contentType: text("content_type").notNull(),
		byteSize: integer("byte_size").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		check(
			"attachments_parent_check",
			sql`(${table.postId} is not null and ${table.commentId} is null) or (${table.postId} is null and ${table.commentId} is not null)`,
		),
		index("idx_attachments_post_id").on(table.postId),
	],
);

export const auditLog = sqliteTable(
	"audit_log",
	{
		id: text("id").primaryKey(),
		actorUserId: text("actor_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		action: text("action").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id").notNull(),
		metadataJson: text("metadata_json", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		createdAt: createdAt(),
	},
	(table) => [index("idx_audit_log_entity").on(table.entityType, table.entityId)],
);

export const authTokens = sqliteTable(
	"auth_tokens",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		purpose: text("purpose", { enum: ["login", "invite"] }).notNull(),
		expiresAt: text("expires_at").notNull(),
		consumedAt: text("consumed_at"),
		createdAt: createdAt(),
	},
	(table) => [
		check(
			"auth_tokens_purpose_check",
			sql`${table.purpose} in ('login', 'invite')`,
		),
		index("idx_auth_tokens_email").on(table.email),
		index("idx_auth_tokens_expires_at").on(table.expiresAt),
	],
);

export const affiliations = sqliteTable("affiliations", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	slug: text("slug").notNull().unique(),
	createdAt: createdAt(),
});

export const organizationAffiliations = sqliteTable(
	"organization_affiliations",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		affiliationId: text("affiliation_id")
			.notNull()
			.references(() => affiliations.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.affiliationId] }),
		index("idx_organization_affiliations_affiliation_id").on(
			table.affiliationId,
		),
	],
);

export const userAffiliations = sqliteTable(
	"user_affiliations",
	{
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		affiliationId: text("affiliation_id")
			.notNull()
			.references(() => affiliations.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.affiliationId] }),
		index("idx_user_affiliations_affiliation_id").on(table.affiliationId),
	],
);

export const videoEmbeds = sqliteTable(
	"video_embeds",
	{
		postId: text("post_id")
			.primaryKey()
			.references(() => posts.id, { onDelete: "cascade" }),
		provider: text("provider", { enum: ["tiktok"] }).notNull(),
		sourceUrl: text("source_url").notNull(),
		videoId: text("video_id"),
		title: text("title"),
		authorName: text("author_name"),
		authorUrl: text("author_url"),
		thumbnailUrl: text("thumbnail_url"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		check("video_embeds_provider_check", sql`${table.provider} in ('tiktok')`),
		index("idx_video_embeds_provider_created_at").on(
			table.provider,
			desc(table.createdAt),
		),
	],
);

export const postReactions = sqliteTable(
	"post_reactions",
	{
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		reaction: text("reaction", { enum: ["support"] })
			.notNull()
			.default("support"),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.postId, table.userId, table.reaction] }),
		check(
			"post_reactions_reaction_check",
			sql`${table.reaction} in ('support')`,
		),
		index("idx_post_reactions_user_id").on(table.userId),
	],
);

export const notifications = sqliteTable(
	"notifications",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		actorUserId: text("actor_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
		commentId: text("comment_id").references(() => comments.id, {
			onDelete: "cascade",
		}),
		type: text("type", { enum: ["comment", "mention", "approval"] }).notNull(),
		body: text("body").notNull(),
		readAt: text("read_at"),
		createdAt: createdAt(),
	},
	(table) => [
		check(
			"notifications_type_check",
			sql`${table.type} in ('comment', 'mention', 'approval')`,
		),
		index("idx_notifications_user_read_created").on(
			table.userId,
			table.readAt,
			desc(table.createdAt),
		),
	],
);

export const postMentions = sqliteTable(
	"post_mentions",
	{
		id: text("id").primaryKey(),
		postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
		commentId: text("comment_id").references(() => comments.id, {
			onDelete: "cascade",
		}),
		mentionedUserId: text("mentioned_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		mentionedByUserId: text("mentioned_by_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [
		check(
			"post_mentions_parent_check",
			sql`(${table.postId} is not null and ${table.commentId} is null) or (${table.postId} is null and ${table.commentId} is not null)`,
		),
		index("idx_post_mentions_mentioned_user").on(
			table.mentionedUserId,
			desc(table.createdAt),
		),
	],
);
