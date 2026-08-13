import type { AuthenticatedUser } from "../lib/auth.server";

export type EventModerationRecord = {
	postId: string;
	title: string;
	body: string;
	authorName: string | null;
	organizationName: string | null;
	startsAt: string;
	endsAt: string | null;
	locationName: string | null;
	registrationUrl: string | null;
	sourceUrl: string | null;
	imageUrl: string | null;
	createdAt: string;
};

export class EventMutationError extends Error {
	constructor(public readonly reason: "not-found" | "forbidden" | "already-reviewed") {
		super(reason);
		this.name = "EventMutationError";
	}
}

export async function canModerateEvents(env: Env, actor: AuthenticatedUser) {
	if (actor.siteRole === "site_admin") return true;
	return (await env.DB.prepare(
		"SELECT 1 FROM organization_memberships WHERE user_id = ?1 AND role = 'org_admin' LIMIT 1",
	).bind(actor.id).first<number>("1")) !== null;
}

export async function listPendingEvents(env: Env, actor: AuthenticatedUser) {
	const result = await env.DB.prepare(
		`SELECT p.id AS postId, p.title, p.body, author.name AS authorName,
		        organization.name AS organizationName, e.starts_at AS startsAt,
		        e.ends_at AS endsAt, e.location_name AS locationName,
		        e.registration_url AS registrationUrl, e.source_url AS sourceUrl,
		        e.image_url AS imageUrl, p.created_at AS createdAt
		 FROM events AS e
		 JOIN posts AS p ON p.id = e.post_id AND p.section = 'event' AND p.status = 'draft'
		 JOIN users AS author ON author.id = p.author_user_id
		 LEFT JOIN organizations AS organization ON organization.id = p.organization_id
		 WHERE e.moderation_status = 'pending'
		   AND (?2 = 1 OR EXISTS (
		     SELECT 1 FROM organization_memberships
		     WHERE organization_id = p.organization_id AND user_id = ?1 AND role = 'org_admin'
		   ))
		 ORDER BY e.starts_at, p.created_at, p.id`,
	)
		.bind(actor.id, actor.siteRole === "site_admin" ? 1 : 0)
		.all<EventModerationRecord>();
	return result.results;
}

export async function reviewEvent(
	env: Env,
	actor: AuthenticatedUser,
	input: { postId: string; decision: "approve" | "reject"; reason: string | null },
) {
	const event = await env.DB.prepare(
		`SELECT p.title, p.author_user_id AS authorUserId, e.moderation_status AS moderationStatus,
		        CASE WHEN ?3 = 1 OR EXISTS (
		          SELECT 1 FROM organization_memberships
		          WHERE organization_id = p.organization_id AND user_id = ?1 AND role = 'org_admin'
		        ) THEN 1 ELSE 0 END AS canModerate
		 FROM posts AS p
		 JOIN events AS e ON e.post_id = p.id
		 WHERE p.id = ?2 AND p.section = 'event' AND p.status = 'draft'`,
	)
		.bind(actor.id, input.postId, actor.siteRole === "site_admin" ? 1 : 0)
		.first<{ title: string; authorUserId: string; moderationStatus: string; canModerate: number }>();
	if (!event) throw new EventMutationError("not-found");
	if (event.canModerate !== 1) throw new EventMutationError("forbidden");
	if (event.moderationStatus !== "pending") throw new EventMutationError("already-reviewed");

	const now = new Date().toISOString();
	const moderationStatus = input.decision === "approve" ? "approved" : "rejected";
	const postStatus = input.decision === "approve" ? "published" : "draft";
	const action = input.decision === "approve" ? "event.approved" : "event.rejected";
	const notificationBody = input.decision === "approve"
		? `Your event “${event.title}” was approved.`
		: `Your event “${event.title}” needs changes before it can be published.`;
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE events
			 SET moderation_status = ?1, reviewed_by_user_id = ?2, reviewed_at = ?3, rejection_reason = ?4
			 WHERE post_id = ?5 AND moderation_status = 'pending'`,
		).bind(moderationStatus, actor.id, now, input.decision === "reject" ? input.reason : null, input.postId),
		env.DB.prepare(
			`UPDATE posts SET status = ?1, updated_at = ?2, archived_at = NULL
			 WHERE id = ?3 AND EXISTS (
			   SELECT 1 FROM events
			   WHERE post_id = ?3 AND moderation_status = ?4
			     AND reviewed_by_user_id = ?5 AND reviewed_at = ?2
			 )`,
		).bind(postStatus, now, input.postId, moderationStatus, actor.id),
		...(event.authorUserId !== actor.id ? [env.DB.prepare(
			`INSERT INTO notifications
			 (id, user_id, actor_user_id, post_id, comment_id, type, body, read_at, created_at)
			 SELECT ?1, ?2, ?3, ?4, NULL, 'approval', ?5, NULL, ?6
			 WHERE EXISTS (
			   SELECT 1 FROM events
			   WHERE post_id = ?4 AND moderation_status = ?7
			     AND reviewed_by_user_id = ?3 AND reviewed_at = ?6
			 )`,
		).bind(crypto.randomUUID(), event.authorUserId, actor.id, input.postId, notificationBody, now, moderationStatus)] : []),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, ?3, 'event', ?4, ?5, ?6
			 WHERE EXISTS (
			   SELECT 1 FROM events
			   WHERE post_id = ?4 AND moderation_status = ?7
			     AND reviewed_by_user_id = ?2 AND reviewed_at = ?6
			 )`,
		).bind(crypto.randomUUID(), actor.id, action, input.postId, JSON.stringify({ reason: input.reason }), now, moderationStatus),
	]);
	if (results[0]?.meta.changes !== 1) throw new EventMutationError("already-reviewed");
	return moderationStatus;
}
