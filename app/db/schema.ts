import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
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
		email: text("email").notNull(),
		displayName: text("display_name").notNull(),
		pronouns: text("pronouns"),
		bio: text("bio"),
		avatarKey: text("avatar_key"),
		role: text("role", { enum: ["member", "site_admin"] })
			.notNull()
			.default("member"),
		status: text("status", { enum: ["invited", "active", "suspended"] })
			.notNull()
			.default("invited"),
		profileVisibility: text("profile_visibility", {
			enum: ["ecosystem", "affiliations", "organizations"],
		})
			.notNull()
			.default("affiliations"),
		lastLoginAt: text("last_login_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex("users_email_unique").on(table.email),
		index("users_status_idx").on(table.status),
		index("users_role_idx").on(table.role),
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
		lastSeenAt: text("last_seen_at").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		index("sessions_user_id_idx").on(table.userId),
		index("sessions_expires_at_idx").on(table.expiresAt),
	],
);

export const authTokens = sqliteTable(
	"auth_tokens",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		tokenHash: text("token_hash").notNull(),
		purpose: text("purpose", { enum: ["sign_in", "invitation"] })
			.notNull()
			.default("sign_in"),
		expiresAt: text("expires_at").notNull(),
		consumedAt: text("consumed_at"),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("auth_tokens_token_hash_unique").on(table.tokenHash),
		index("auth_tokens_email_idx").on(table.email),
		index("auth_tokens_expires_at_idx").on(table.expiresAt),
	],
);

export const organizations = sqliteTable(
	"organizations",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description"),
		logoKey: text("logo_key"),
		websiteUrl: text("website_url"),
		eventSourceUrl: text("event_source_url"),
		status: text("status", { enum: ["active", "archived"] })
			.notNull()
			.default("active"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex("organizations_slug_unique").on(table.slug),
		index("organizations_status_idx").on(table.status),
		index("organizations_name_idx").on(table.name),
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
		role: text("role", { enum: ["admin", "contributor", "viewer"] })
			.notNull()
			.default("viewer"),
		status: text("status", { enum: ["pending", "active", "removed"] })
			.notNull()
			.default("active"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.userId] }),
		index("organization_memberships_user_idx").on(table.userId),
		index("organization_memberships_status_idx").on(table.status),
	],
);

export const affiliations = sqliteTable(
	"affiliations",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description"),
		kind: text("kind", { enum: ["coalition", "network", "region"] })
			.notNull()
			.default("coalition"),
		visibility: text("visibility", { enum: ["listed", "private"] })
			.notNull()
			.default("listed"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex("affiliations_slug_unique").on(table.slug),
		index("affiliations_kind_idx").on(table.kind),
	],
);

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
		index("organization_affiliations_affiliation_idx").on(
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
		source: text("source", { enum: ["direct", "inherited"] })
			.notNull()
			.default("direct"),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.affiliationId] }),
		index("user_affiliations_affiliation_idx").on(table.affiliationId),
	],
);

export const invitations = sqliteTable(
	"invitations",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		invitedByUserId: text("invited_by_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		organizationId: text("organization_id").references(
			() => organizations.id,
			{ onDelete: "cascade" },
		),
		organizationRole: text("organization_role", {
			enum: ["admin", "contributor", "viewer"],
		}),
		tokenHash: text("token_hash").notNull(),
		status: text("status", { enum: ["pending", "accepted", "expired", "revoked"] })
			.notNull()
			.default("pending"),
		expiresAt: text("expires_at").notNull(),
		acceptedAt: text("accepted_at"),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
		index("invitations_email_idx").on(table.email),
		index("invitations_status_idx").on(table.status),
	],
);

export const posts = sqliteTable(
	"posts",
	{
		id: text("id").primaryKey(),
		authorUserId: text("author_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		organizationId: text("organization_id").references(
			() => organizations.id,
			{ onDelete: "set null" },
		),
		section: text("section", {
			enum: ["legislation", "events", "projects", "updates"],
		}).notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		status: text("status", { enum: ["draft", "published", "archived"] })
			.notNull()
			.default("draft"),
		visibility: text("visibility", {
			enum: ["ecosystem", "affiliations", "organization"],
		})
			.notNull()
			.default("affiliations"),
		publishedAt: text("published_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		index("posts_section_status_idx").on(table.section, table.status),
		index("posts_author_idx").on(table.authorUserId),
		index("posts_organization_idx").on(table.organizationId),
		index("posts_published_at_idx").on(table.publishedAt),
	],
);

export const comments = sqliteTable(
	"comments",
	{
		id: text("id").primaryKey(),
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		authorUserId: text("author_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		parentCommentId: text("parent_comment_id").references(
			(): AnySQLiteColumn => comments.id,
			{ onDelete: "cascade" },
		),
		body: text("body").notNull(),
		deletedAt: text("deleted_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		index("comments_post_created_idx").on(table.postId, table.createdAt),
		index("comments_author_idx").on(table.authorUserId),
	],
);

export const events = sqliteTable(
	"events",
	{
		id: text("id").primaryKey(),
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		startsAt: text("starts_at").notNull(),
		endsAt: text("ends_at"),
		timezone: text("timezone").notNull().default("America/New_York"),
		locationName: text("location_name"),
		address: text("address"),
		externalUrl: text("external_url"),
		imageKey: text("image_key"),
		sourceUrl: text("source_url"),
		approvalStatus: text("approval_status", {
			enum: ["pending", "approved", "rejected"],
		})
			.notNull()
			.default("pending"),
		submittedByUserId: text("submitted_by_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		reviewedAt: text("reviewed_at"),
		rejectionReason: text("rejection_reason"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex("events_post_id_unique").on(table.postId),
		index("events_approval_status_idx").on(table.approvalStatus),
		index("events_starts_at_idx").on(table.startsAt),
		index("events_source_url_idx").on(table.sourceUrl),
	],
);

export const projects = sqliteTable(
	"projects",
	{
		id: text("id").primaryKey(),
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		ownerOrganizationId: text("owner_organization_id").references(
			() => organizations.id,
			{ onDelete: "set null" },
		),
		status: text("status", {
			enum: ["proposed", "active", "on_hold", "completed"],
		})
			.notNull()
			.default("proposed"),
		startsAt: text("starts_at"),
		endsAt: text("ends_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex("projects_post_id_unique").on(table.postId),
		index("projects_status_idx").on(table.status),
		index("projects_owner_organization_idx").on(table.ownerOrganizationId),
	],
);

export const attachments = sqliteTable(
	"attachments",
	{
		id: text("id").primaryKey(),
		postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
		commentId: text("comment_id").references(() => comments.id, {
			onDelete: "cascade",
		}),
		r2Key: text("r2_key").notNull(),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		altText: text("alt_text"),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("attachments_r2_key_unique").on(table.r2Key),
		index("attachments_post_idx").on(table.postId),
		index("attachments_comment_idx").on(table.commentId),
	],
);

export const videoEmbeds = sqliteTable(
	"video_embeds",
	{
		id: text("id").primaryKey(),
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		url: text("url").notNull(),
		title: text("title"),
		createdAt: createdAt(),
	},
	(table) => [index("video_embeds_post_idx").on(table.postId)],
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
		reaction: text("reaction", {
			enum: ["support", "celebrate", "insightful", "thanks"],
		}).notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.postId, table.userId, table.reaction] }),
		index("post_reactions_user_idx").on(table.userId),
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
		type: text("type", {
			enum: ["mention", "comment", "reaction", "invitation", "moderation"],
		}).notNull(),
		postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
		commentId: text("comment_id").references(() => comments.id, {
			onDelete: "cascade",
		}),
		readAt: text("read_at"),
		createdAt: createdAt(),
	},
	(table) => [
		index("notifications_user_read_idx").on(table.userId, table.readAt),
		index("notifications_created_at_idx").on(table.createdAt),
	],
);

export const postMentions = sqliteTable(
	"post_mentions",
	{
		id: text("id").primaryKey(),
		postId: text("post_id")
			.notNull()
			.references(() => posts.id, { onDelete: "cascade" }),
		commentId: text("comment_id").references(() => comments.id, {
			onDelete: "cascade",
		}),
		mentionedUserId: text("mentioned_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [
		index("post_mentions_user_idx").on(table.mentionedUserId),
		index("post_mentions_post_idx").on(table.postId),
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
		entityId: text("entity_id"),
		metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
		createdAt: createdAt(),
	},
	(table) => [
		index("audit_log_actor_idx").on(table.actorUserId),
		index("audit_log_entity_idx").on(table.entityType, table.entityId),
		index("audit_log_created_at_idx").on(table.createdAt),
	],
);
