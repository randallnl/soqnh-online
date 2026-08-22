import type { AuthenticatedUser } from "../lib/auth.server";
import { getPostById } from "./posts.server";

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
		     OR ?2 IS NULL
		     OR EXISTS (
		       SELECT 1 FROM organization_memberships
		       WHERE organization_id = ?2 AND user_id = u.id
		     )
		     OR (?3 = 'members' AND EXISTS (
		       SELECT 1 FROM organization_affiliations AS post_affiliation
		       WHERE post_affiliation.organization_id = ?2
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
		   )
		 ORDER BY coalesce(u.name, 'Member') COLLATE NOCASE, u.id
		 LIMIT 100`,
	).bind(actor.id, post.organizationId, post.visibility, actor.siteRole === "site_admin" ? 1 : 0).all<MentionableMember>();
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
