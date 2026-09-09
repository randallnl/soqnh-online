import type { AuthenticatedUser } from "../lib/auth.server";
import { getPostById } from "./posts.server";
import { listVisibleMembers } from "./profiles.server";

export type MentionableMember = {
	id: string;
	name: string | null;
	profileTitle: string | null;
	organizationNames: string | null;
};

export class InteractionMutationError extends Error {
	constructor(public readonly reason: "post-unavailable" | "member-unavailable") {
		super(reason);
		this.name = "InteractionMutationError";
	}
}

async function requirePublishedPost(env: Env, actor: AuthenticatedUser, postId: string) {
	const post = await getPostById(env, actor, postId);
	if (!post || post.status !== "published") throw new InteractionMutationError("post-unavailable");
	return post;
}

export async function togglePostSupport(env: Env, actor: AuthenticatedUser, postId: string) {
	await requirePublishedPost(env, actor, postId);
	const existing = await env.DB.prepare(
		"SELECT 1 FROM post_reactions WHERE post_id = ?1 AND user_id = ?2 AND reaction = 'support'",
	).bind(postId, actor.id).first<number>("1");
	const now = new Date().toISOString();
	const supported = existing === null;
	await env.DB.batch([
		supported
			? env.DB.prepare("INSERT INTO post_reactions (post_id, user_id, reaction, created_at) VALUES (?1, ?2, 'support', ?3)").bind(postId, actor.id, now)
			: env.DB.prepare("DELETE FROM post_reactions WHERE post_id = ?1 AND user_id = ?2 AND reaction = 'support'").bind(postId, actor.id),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, ?3, 'post', ?4, NULL, ?5)`,
		).bind(crypto.randomUUID(), actor.id, supported ? "post.supported" : "post.unsupported", postId, now),
	]);
	return supported;
}

export async function listMentionableMembers(env: Env, actor: AuthenticatedUser, postId: string) {
	const post = await requirePublishedPost(env, actor, postId);
	const result = await env.DB.prepare(
		`SELECT u.id, u.name, u.profile_title AS profileTitle,
		        (SELECT group_concat(name, ', ') FROM (
		          SELECT o.name FROM organization_memberships AS om
		          JOIN organizations AS o ON o.id = om.organization_id
		          WHERE om.user_id = u.id AND o.status != 'archived'
		          ORDER BY o.name COLLATE NOCASE
		        )) AS organizationNames
		 FROM users AS u
		 WHERE u.status = 'active' AND u.id != ?1
		   AND (?4 = 1 OR u.profile_visibility != 'hidden')
		   AND (
		     u.site_role = 'site_admin'
		     OR (?3 = 'organization' AND EXISTS (
		       SELECT 1 FROM organization_memberships
		       WHERE organization_id = ?2 AND user_id = u.id
		     ))
		     OR (?3 = 'members' AND EXISTS (
		       SELECT 1 FROM post_affiliations AS post_affiliation
		       WHERE post_affiliation.post_id = ?5
		         AND post_affiliation.affiliation_id IN (
		           SELECT affiliation_id FROM user_affiliations WHERE user_id = u.id
		           UNION
		           SELECT member_affiliation.affiliation_id
		           FROM organization_memberships AS membership
		           JOIN organizations AS member_organization
		             ON member_organization.id = membership.organization_id AND member_organization.status != 'archived'
		           JOIN organization_affiliations AS member_affiliation
		             ON member_affiliation.organization_id = membership.organization_id
		           WHERE membership.user_id = u.id
		         )
		     ))
		     OR (?3 = 'members' AND NOT EXISTS (
		       SELECT 1 FROM post_affiliations WHERE post_id = ?5
		     ))
		   )
		 ORDER BY coalesce(u.name, 'Member') COLLATE NOCASE, u.id
		 LIMIT 100`,
	).bind(actor.id, post.organizationId, post.visibility, actor.siteRole === "site_admin" ? 1 : 0, post.id).all<MentionableMember>();
	return result.results;
}

export async function getMentionRecipient(env: Env, actor: AuthenticatedUser, postId: string, userId: string) {
	const candidate = await env.DB.prepare(
		`SELECT id, email, name, site_role AS siteRole, status
		 FROM users WHERE id = ?1 AND status = 'active'
		   AND (?2 = 1 OR profile_visibility != 'hidden')`,
	).bind(userId, actor.siteRole === "site_admin" ? 1 : 0).first<AuthenticatedUser>();
	if (!candidate || candidate.id === actor.id) throw new InteractionMutationError("member-unavailable");
	const visible = await getPostById(env, candidate, postId);
	if (!visible || visible.status !== "published") throw new InteractionMutationError("member-unavailable");
	return candidate;
}

export async function syncPostMentions(env: Env, actor: AuthenticatedUser, postId: string, userIds: string[], notifyExisting = false) {
	const post = await getPostById(env, actor, postId);
	if (!post) throw new InteractionMutationError("post-unavailable");
	const existing = await env.DB.prepare(
		"SELECT mentioned_user_id AS userId FROM post_mentions WHERE post_id = ?1",
	).bind(postId).all<{ userId: string }>();
	const existingIds = new Set(existing.results.map((row) => row.userId));
	const requestedIds = [...new Set(userIds)].filter((userId) => userId !== actor.id).slice(0, 10);
	const recipients: Array<{ id: string }> = post.status === "published" ? (await Promise.all(requestedIds.map(async (userId) => {
		try {
			return await getMentionRecipient(env, actor, postId, userId);
		} catch (error) {
			if (error instanceof InteractionMutationError) return null;
			throw error;
		}
	}))).filter((recipient): recipient is AuthenticatedUser => recipient !== null) : [];
	if (post.status !== "published") {
		const visibleIds = new Set((await listVisibleMembers(env, actor)).map((member) => member.id));
		recipients.push(...requestedIds.filter((userId) => visibleIds.has(userId)).map((id) => ({ id })));
	}
	const now = new Date().toISOString();
	const actorName = actor.name || "A member";
	await env.DB.batch([
		env.DB.prepare("DELETE FROM post_mentions WHERE post_id = ?1").bind(postId),
		...recipients.flatMap((recipient) => [
			env.DB.prepare(
				`INSERT INTO post_mentions
				 (id, post_id, comment_id, mentioned_user_id, mentioned_by_user_id, created_at)
				 VALUES (?1, ?2, NULL, ?3, ?4, ?5)`,
			).bind(crypto.randomUUID(), postId, recipient.id, actor.id, now),
			...((!notifyExisting && existingIds.has(recipient.id)) || post.status !== "published" ? [] : [env.DB.prepare(
				`INSERT INTO notifications
				 (id, user_id, actor_user_id, post_id, comment_id, type, body, read_at, created_at)
				 VALUES (?1, ?2, ?3, ?4, NULL, 'mention', ?5, NULL, ?6)`,
			).bind(crypto.randomUUID(), recipient.id, actor.id, postId, `${actorName} mentioned you in an update.`, now)]),
		]),
	]);
}

export async function listPostMentionUserIds(env: Env, actor: AuthenticatedUser, postId: string) {
	const post = await getPostById(env, actor, postId);
	if (!post) throw new InteractionMutationError("post-unavailable");
	const result = await env.DB.prepare(
		"SELECT mentioned_user_id AS userId FROM post_mentions WHERE post_id = ?1 ORDER BY created_at, id",
	).bind(postId).all<{ userId: string }>();
	return result.results.map((row) => row.userId);
}
