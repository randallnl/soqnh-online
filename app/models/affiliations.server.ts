import type { AuthenticatedUser } from "../lib/auth.server";

export type AffiliationRecord = {
	id: string;
	name: string;
	slug: string;
	createdAt: string;
	organizationCount: number;
	directMemberCount: number;
	effectiveMemberCount: number;
};

export type AffiliationOrganizationLink = {
	affiliationId: string;
	organizationId: string;
	organizationName: string;
};

export type AffiliationUserLink = {
	affiliationId: string;
	userId: string;
	userName: string | null;
	userEmail: string;
};

export type EffectiveAffiliationSource = {
	affiliationId: string;
	userId: string;
	source: "direct" | "organization";
	sourceName: string;
};

export type AffiliationAssignableOrganization = {
	id: string;
	name: string;
	status: "active" | "inactive";
};

export type AffiliationAssignableMember = {
	id: string;
	name: string | null;
	email: string;
};

export class AffiliationMutationError extends Error {
	constructor(
		public readonly reason:
			| "not-found"
			| "slug-conflict"
			| "name-conflict"
			| "organization-unavailable"
			| "member-unavailable"
			| "link-not-found"
			| "forbidden",
	) {
		super(reason);
		this.name = "AffiliationMutationError";
	}
}

function requireAffiliationAdmin(actor: AuthenticatedUser) {
	if (actor.siteRole !== "site_admin") {
		throw new AffiliationMutationError("forbidden");
	}
}

function mapUniqueError(error: unknown) {
	if (!(error instanceof Error) || !error.message.includes("UNIQUE")) return null;
	return new AffiliationMutationError(
		error.message.includes("affiliations.name") ? "name-conflict" : "slug-conflict",
	);
}

export async function getAffiliationAdministrationData(env: Env) {
	const [affiliationResult, organizationLinkResult, userLinkResult, effectiveResult, organizationResult, memberResult] =
		await Promise.all([
			env.DB.prepare(
				`WITH effective AS (
				   SELECT ua.user_id, ua.affiliation_id
				   FROM user_affiliations AS ua
				   JOIN users AS direct_user ON direct_user.id = ua.user_id AND direct_user.status = 'active'
				   UNION
				   SELECT om.user_id, oa.affiliation_id
				   FROM organization_memberships AS om
				   JOIN users AS member_user ON member_user.id = om.user_id AND member_user.status = 'active'
				   JOIN organizations AS o ON o.id = om.organization_id AND o.status != 'archived'
				   JOIN organization_affiliations AS oa ON oa.organization_id = om.organization_id
				 )
				 SELECT a.id, a.name, a.slug, a.created_at AS createdAt,
				        count(DISTINCT oa.organization_id) AS organizationCount,
				        count(DISTINCT ua.user_id) AS directMemberCount,
				        count(DISTINCT e.user_id) AS effectiveMemberCount
				 FROM affiliations AS a
				 LEFT JOIN organization_affiliations AS oa ON oa.affiliation_id = a.id
				 LEFT JOIN user_affiliations AS ua ON ua.affiliation_id = a.id
				 LEFT JOIN effective AS e ON e.affiliation_id = a.id
				 GROUP BY a.id
				 ORDER BY a.name COLLATE NOCASE`,
			).all<AffiliationRecord>(),
			env.DB.prepare(
				`SELECT oa.affiliation_id AS affiliationId,
				        o.id AS organizationId,
				        o.name AS organizationName
				 FROM organization_affiliations AS oa
				 JOIN organizations AS o ON o.id = oa.organization_id
				 ORDER BY o.name COLLATE NOCASE`,
			).all<AffiliationOrganizationLink>(),
			env.DB.prepare(
				`SELECT ua.affiliation_id AS affiliationId,
				        u.id AS userId,
				        u.name AS userName,
				        u.email AS userEmail
				 FROM user_affiliations AS ua
				 JOIN users AS u ON u.id = ua.user_id
				 ORDER BY coalesce(u.name, u.email) COLLATE NOCASE`,
			).all<AffiliationUserLink>(),
			env.DB.prepare(
				`SELECT ua.affiliation_id AS affiliationId,
				        ua.user_id AS userId,
				        'direct' AS source,
				        'Direct assignment' AS sourceName
				 FROM user_affiliations AS ua
				 JOIN users AS direct_user ON direct_user.id = ua.user_id AND direct_user.status = 'active'
				 UNION ALL
				 SELECT oa.affiliation_id AS affiliationId,
				        om.user_id AS userId,
				        'organization' AS source,
				        o.name AS sourceName
				 FROM organization_memberships AS om
				 JOIN users AS member_user ON member_user.id = om.user_id AND member_user.status = 'active'
				 JOIN organizations AS o ON o.id = om.organization_id AND o.status != 'archived'
				 JOIN organization_affiliations AS oa ON oa.organization_id = om.organization_id`,
			).all<EffectiveAffiliationSource>(),
			env.DB.prepare(
				`SELECT id, name, status
				 FROM organizations
				 WHERE status != 'archived'
				 ORDER BY name COLLATE NOCASE`,
			).all<AffiliationAssignableOrganization>(),
			env.DB.prepare(
				`SELECT id, name, email
				 FROM users
				 WHERE status = 'active'
				 ORDER BY coalesce(name, email) COLLATE NOCASE`,
			).all<AffiliationAssignableMember>(),
		]);

	return {
		affiliations: affiliationResult.results,
		organizationLinks: organizationLinkResult.results,
		userLinks: userLinkResult.results,
		effectiveSources: effectiveResult.results,
		organizations: organizationResult.results,
		members: memberResult.results,
	};
}

export async function createAffiliation(
	env: Env,
	actor: AuthenticatedUser,
	input: { name: string; slug: string },
) {
	requireAffiliationAdmin(actor);
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	try {
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO affiliations (id, name, slug, created_at)
				 VALUES (?1, ?2, ?3, ?4)`,
			).bind(id, input.name, input.slug, now),
			env.DB.prepare(
				`INSERT INTO audit_log
				 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
				 VALUES (?1, ?2, 'affiliation.created', 'affiliation', ?3, ?4, ?5)`,
			).bind(
				crypto.randomUUID(),
				actor.id,
				id,
				JSON.stringify({ name: input.name, slug: input.slug }),
				now,
			),
		]);
	} catch (error) {
		const mapped = mapUniqueError(error);
		if (mapped) throw mapped;
		throw error;
	}
	return { id };
}

export async function updateAffiliation(
	env: Env,
	actor: AuthenticatedUser,
	input: { affiliationId: string; name: string; slug: string },
) {
	requireAffiliationAdmin(actor);
	const now = new Date().toISOString();
	try {
		const results = await env.DB.batch([
			env.DB.prepare(
				`UPDATE affiliations SET name = ?1, slug = ?2
				 WHERE id = ?3`,
			).bind(input.name, input.slug, input.affiliationId),
			env.DB.prepare(
				`INSERT INTO audit_log
				 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
				 SELECT ?1, ?2, 'affiliation.updated', 'affiliation', ?3, ?4, ?5
				 WHERE EXISTS (SELECT 1 FROM affiliations WHERE id = ?3 AND name = ?6 AND slug = ?7)`,
			).bind(
				crypto.randomUUID(),
				actor.id,
				input.affiliationId,
				JSON.stringify({ name: input.name, slug: input.slug }),
				now,
				input.name,
				input.slug,
			),
		]);
		if (results[0]?.meta.changes !== 1) {
			throw new AffiliationMutationError("not-found");
		}
	} catch (error) {
		if (error instanceof AffiliationMutationError) throw error;
		const mapped = mapUniqueError(error);
		if (mapped) throw mapped;
		throw error;
	}
}

export async function addOrganizationAffiliation(
	env: Env,
	actor: AuthenticatedUser,
	input: { affiliationId: string; organizationId: string },
) {
	requireAffiliationAdmin(actor);
	const available = await env.DB.prepare(
		`SELECT 1 FROM organizations WHERE id = ?1 AND status != 'archived'`,
	)
		.bind(input.organizationId)
		.first<number>("1");
	if (available === null) {
		throw new AffiliationMutationError("organization-unavailable");
	}
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO organization_affiliations
			 (organization_id, affiliation_id, created_at)
			 SELECT ?1, ?2, ?3
			 WHERE EXISTS (SELECT 1 FROM affiliations WHERE id = ?2)
			 ON CONFLICT(organization_id, affiliation_id) DO NOTHING`,
		).bind(input.organizationId, input.affiliationId, now),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'affiliation.organization_added', 'affiliation', ?3, ?4, ?5
			 WHERE EXISTS (
			   SELECT 1 FROM organization_affiliations
			   WHERE organization_id = ?6 AND affiliation_id = ?3 AND created_at = ?5
			 )`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			input.affiliationId,
			JSON.stringify({ organizationId: input.organizationId }),
			now,
			input.organizationId,
		),
	]);
	if (results[0]?.meta.changes !== 1) {
		const affiliation = await env.DB.prepare(
			"SELECT 1 FROM affiliations WHERE id = ?1",
		)
			.bind(input.affiliationId)
			.first<number>("1");
		if (affiliation === null) throw new AffiliationMutationError("not-found");
	}
}

export async function removeOrganizationAffiliation(
	env: Env,
	actor: AuthenticatedUser,
	input: { affiliationId: string; organizationId: string },
) {
	requireAffiliationAdmin(actor);
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`DELETE FROM organization_affiliations
			 WHERE organization_id = ?1 AND affiliation_id = ?2`,
		).bind(input.organizationId, input.affiliationId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'affiliation.organization_removed', 'affiliation', ?3, ?4, ?5
			 WHERE changes() = 1`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			input.affiliationId,
			JSON.stringify({ organizationId: input.organizationId }),
			now,
		),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new AffiliationMutationError("link-not-found");
	}
}

export async function addUserAffiliation(
	env: Env,
	actor: AuthenticatedUser,
	input: { affiliationId: string; userId: string },
) {
	requireAffiliationAdmin(actor);
	const available = await env.DB.prepare(
		`SELECT 1 FROM users WHERE id = ?1 AND status = 'active'`,
	)
		.bind(input.userId)
		.first<number>("1");
	if (available === null) throw new AffiliationMutationError("member-unavailable");
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO user_affiliations (user_id, affiliation_id, created_at)
			 SELECT ?1, ?2, ?3
			 WHERE EXISTS (SELECT 1 FROM affiliations WHERE id = ?2)
			 ON CONFLICT(user_id, affiliation_id) DO NOTHING`,
		).bind(input.userId, input.affiliationId, now),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'affiliation.user_added', 'affiliation', ?3, ?4, ?5
			 WHERE EXISTS (
			   SELECT 1 FROM user_affiliations
			   WHERE user_id = ?6 AND affiliation_id = ?3 AND created_at = ?5
			 )`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			input.affiliationId,
			JSON.stringify({ userId: input.userId }),
			now,
			input.userId,
		),
	]);
	if (results[0]?.meta.changes !== 1) {
		const affiliation = await env.DB.prepare(
			"SELECT 1 FROM affiliations WHERE id = ?1",
		)
			.bind(input.affiliationId)
			.first<number>("1");
		if (affiliation === null) throw new AffiliationMutationError("not-found");
	}
}

export async function removeUserAffiliation(
	env: Env,
	actor: AuthenticatedUser,
	input: { affiliationId: string; userId: string },
) {
	requireAffiliationAdmin(actor);
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`DELETE FROM user_affiliations
			 WHERE user_id = ?1 AND affiliation_id = ?2`,
		).bind(input.userId, input.affiliationId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'affiliation.user_removed', 'affiliation', ?3, ?4, ?5
			 WHERE changes() = 1`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			input.affiliationId,
			JSON.stringify({ userId: input.userId }),
			now,
		),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new AffiliationMutationError("link-not-found");
	}
}
