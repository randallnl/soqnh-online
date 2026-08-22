import type { AuthenticatedUser } from "../lib/auth.server";

export type MemberDirectoryRecord = {
	id: string;
	name: string | null;
	avatarObjectKey: string | null;
	profileTitle: string | null;
	pronouns: string | null;
	bio: string | null;
	location: string | null;
	organizationNames: string | null;
	affiliationNames: string | null;
};

export type MemberProfileRecord = MemberDirectoryRecord & {
	email: string;
	websiteUrl: string | null;
	profileVisibility: "members" | "hidden";
	siteRole: "member" | "site_admin";
	organizations: Array<{ id: string; name: string; slug: string; role: "viewer" | "contributor" | "org_admin"; logoObjectKey: string | null }>;
	affiliations: Array<{ id: string; name: string; slug: string }>;
};

const effectiveAffiliations = `effective_affiliations AS (
	SELECT user_id, affiliation_id FROM user_affiliations
	UNION
	SELECT om.user_id, oa.affiliation_id
	FROM organization_memberships AS om
	JOIN organizations AS o ON o.id = om.organization_id AND o.status != 'archived'
	JOIN organization_affiliations AS oa ON oa.organization_id = om.organization_id
)`;

const visiblePerson = `(
	?2 = 1 OR u.id = ?1 OR (
		u.profile_visibility = 'members' AND EXISTS (
			SELECT 1 FROM effective_affiliations AS viewer_affiliation
			JOIN effective_affiliations AS target_affiliation
			  ON target_affiliation.affiliation_id = viewer_affiliation.affiliation_id
			WHERE viewer_affiliation.user_id = ?1 AND target_affiliation.user_id = u.id
		)
	)
)`;

export async function listVisibleMembers(env: Env, viewer: AuthenticatedUser) {
	const result = await env.DB.prepare(
		`WITH ${effectiveAffiliations}
		 SELECT u.id, u.name, u.avatar_object_key AS avatarObjectKey,
		        u.profile_title AS profileTitle, u.pronouns, u.bio, u.location,
		        (SELECT group_concat(name, ', ') FROM (
		          SELECT DISTINCT o.name
		          FROM organization_memberships AS om JOIN organizations AS o ON o.id = om.organization_id
		          WHERE om.user_id = u.id AND o.status != 'archived' ORDER BY o.name COLLATE NOCASE
		        )) AS organizationNames,
		        (SELECT group_concat(name, ', ') FROM (
		          SELECT DISTINCT a.name
		          FROM effective_affiliations AS ea JOIN affiliations AS a ON a.id = ea.affiliation_id
		          WHERE ea.user_id = u.id ORDER BY a.name COLLATE NOCASE
		        )) AS affiliationNames
		 FROM users AS u
		 WHERE u.status = 'active' AND u.id != 'system:event-scraper' AND ${visiblePerson}
		 ORDER BY coalesce(u.name, u.email) COLLATE NOCASE`,
	)
		.bind(viewer.id, viewer.siteRole === "site_admin" ? 1 : 0)
		.all<MemberDirectoryRecord>();
	return result.results;
}

export async function getVisibleMemberProfile(env: Env, viewer: AuthenticatedUser, memberId: string) {
	const member = await env.DB.prepare(
		`WITH ${effectiveAffiliations}
		 SELECT u.id, u.email, u.name, u.avatar_object_key AS avatarObjectKey,
		        u.profile_title AS profileTitle, u.pronouns, u.bio, u.location,
		        u.website_url AS websiteUrl, u.profile_visibility AS profileVisibility,
		        u.site_role AS siteRole,
		        (SELECT group_concat(name, ', ') FROM (
		          SELECT DISTINCT o.name FROM organization_memberships AS om
		          JOIN organizations AS o ON o.id = om.organization_id
		          WHERE om.user_id = u.id AND o.status != 'archived' ORDER BY o.name COLLATE NOCASE
		        )) AS organizationNames,
		        (SELECT group_concat(name, ', ') FROM (
		          SELECT DISTINCT a.name FROM effective_affiliations AS ea
		          JOIN affiliations AS a ON a.id = ea.affiliation_id
		          WHERE ea.user_id = u.id ORDER BY a.name COLLATE NOCASE
		        )) AS affiliationNames
		 FROM users AS u
		 WHERE u.id = ?3 AND u.status = 'active' AND u.id != 'system:event-scraper' AND ${visiblePerson}
		 LIMIT 1`,
	)
		.bind(viewer.id, viewer.siteRole === "site_admin" ? 1 : 0, memberId)
		.first<Omit<MemberProfileRecord, "organizations" | "affiliations">>();
	if (!member) return null;
	const [organizations, affiliations] = await Promise.all([
		env.DB.prepare(
			`SELECT o.id, o.name, o.slug, om.role, o.logo_object_key AS logoObjectKey
			 FROM organization_memberships AS om JOIN organizations AS o ON o.id = om.organization_id
			 WHERE om.user_id = ?1 AND o.status != 'archived' ORDER BY o.name COLLATE NOCASE`,
		).bind(member.id).all<MemberProfileRecord["organizations"][number]>(),
		env.DB.prepare(
			`WITH ${effectiveAffiliations}
			 SELECT DISTINCT a.id, a.name, a.slug FROM effective_affiliations AS ea
			 JOIN affiliations AS a ON a.id = ea.affiliation_id
			 WHERE ea.user_id = ?1 ORDER BY a.name COLLATE NOCASE`,
		).bind(member.id).all<MemberProfileRecord["affiliations"][number]>(),
	]);
	return { ...member, organizations: organizations.results, affiliations: affiliations.results };
}

export async function getOwnProfileEditorData(env: Env, actor: AuthenticatedUser) {
	const [profile, affiliations, direct] = await Promise.all([
		getVisibleMemberProfile(env, actor, actor.id),
		env.DB.prepare("SELECT id, name, slug FROM affiliations ORDER BY name COLLATE NOCASE").all<{ id: string; name: string; slug: string }>(),
		env.DB.prepare("SELECT affiliation_id AS affiliationId FROM user_affiliations WHERE user_id = ?1").bind(actor.id).all<{ affiliationId: string }>(),
	]);
	return { profile, affiliations: affiliations.results, directAffiliationIds: direct.results.map((row) => row.affiliationId) };
}

export async function updateOwnProfile(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		name: string;
		profileTitle: string | null;
		pronouns: string | null;
		bio: string | null;
		location: string | null;
		websiteUrl: string | null;
		profileVisibility: "members" | "hidden";
		affiliationIds: string[];
		avatarObjectKey: string | null;
	},
) {
	const validAffiliations = input.affiliationIds.length === 0 ? [] : (await env.DB.prepare(
		`SELECT id FROM affiliations WHERE id IN (${input.affiliationIds.map(() => "?").join(",")})`,
	).bind(...input.affiliationIds).all<{ id: string }>()).results.map((row) => row.id);
	if (validAffiliations.length !== new Set(input.affiliationIds).size) throw new Error("One or more affiliations are unavailable.");
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			`UPDATE users SET name = ?1, profile_title = ?2, pronouns = ?3, bio = ?4,
			 location = ?5, website_url = ?6, profile_visibility = ?7,
			 avatar_object_key = ?8, updated_at = ?9 WHERE id = ?10 AND status = 'active'`,
		).bind(input.name, input.profileTitle, input.pronouns, input.bio, input.location,
			input.websiteUrl, input.profileVisibility, input.avatarObjectKey, now, actor.id),
		env.DB.prepare("DELETE FROM user_affiliations WHERE user_id = ?1").bind(actor.id),
		...validAffiliations.map((affiliationId) => env.DB.prepare(
			"INSERT INTO user_affiliations (user_id, affiliation_id, created_at) VALUES (?1, ?2, ?3)",
		).bind(actor.id, affiliationId, now)),
		env.DB.prepare(
			`INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'member.profile_self_updated', 'user', ?2, ?3, ?4)`,
		).bind(crypto.randomUUID(), actor.id, JSON.stringify({ profileVisibility: input.profileVisibility }), now),
	]);
}

export async function canReadIdentityObject(env: Env, viewer: AuthenticatedUser, objectKey: string) {
	if (objectKey.startsWith("profile-photos/")) {
		return (await env.DB.prepare(
			`WITH ${effectiveAffiliations}
			 SELECT 1 FROM users AS u
			 WHERE u.avatar_object_key = ?3 AND u.status = 'active' AND ${visiblePerson} LIMIT 1`,
		).bind(viewer.id, viewer.siteRole === "site_admin" ? 1 : 0, objectKey).first<number>("1")) !== null;
	}
	if (objectKey.startsWith("org-logos/")) {
		return (await env.DB.prepare(
			`WITH viewer_affiliations AS (
			 SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
			 UNION SELECT oa.affiliation_id FROM organization_memberships AS om
			 JOIN organizations AS member_org ON member_org.id = om.organization_id AND member_org.status != 'archived'
			 JOIN organization_affiliations AS oa ON oa.organization_id = om.organization_id WHERE om.user_id = ?1
			)
			 SELECT 1 FROM organizations AS o WHERE o.logo_object_key = ?2 AND o.status != 'archived'
			 AND (?3 = 1 OR EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = o.id AND user_id = ?1)
			 OR EXISTS (SELECT 1 FROM organization_affiliations AS oa JOIN viewer_affiliations AS va ON va.affiliation_id = oa.affiliation_id WHERE oa.organization_id = o.id)) LIMIT 1`,
		).bind(viewer.id, objectKey, viewer.siteRole === "site_admin" ? 1 : 0).first<number>("1")) !== null;
	}
	return false;
}
