import type { AuthenticatedUser } from "../lib/auth.server";
import type {
	OrganizationRole,
	OrganizationStatus,
} from "../lib/organizations";

export type OrganizationRecord = {
	id: string;
	name: string;
	slug: string;
	summary: string | null;
	description: string | null;
	websiteUrl: string | null;
	contactEmail: string | null;
	logoObjectKey: string | null;
	status: OrganizationStatus;
	createdAt: string;
	updatedAt: string;
	memberCount: number;
	affiliations: OrganizationAffiliation[];
};

export type OrganizationAffiliation = {
	id: string;
	name: string;
	slug: string;
};

export type OrganizationMember = {
	organizationId: string;
	userId: string;
	name: string | null;
	email: string;
	role: OrganizationRole;
	createdAt: string;
};

export type VisibleOrganizationMember = {
	organizationId: string;
	userId: string;
	name: string | null;
	avatarObjectKey: string | null;
	role: OrganizationRole;
	createdAt: string;
};

export type AvailableMember = {
	id: string;
	name: string | null;
	email: string;
};

export class OrganizationMutationError extends Error {
	constructor(
		public readonly reason:
			| "not-found"
			| "slug-conflict"
			| "member-unavailable"
			| "membership-not-found"
			| "forbidden"
			| "self-management",
	) {
		super(reason);
		this.name = "OrganizationMutationError";
	}
}

type OrganizationRow = Omit<OrganizationRecord, "affiliations">;

async function attachAffiliations(env: Env, organizations: OrganizationRow[]) {
	if (organizations.length === 0) return [];
	const result = await env.DB.prepare(
		`SELECT oa.organization_id AS organizationId,
		        a.id, a.name, a.slug
		 FROM organization_affiliations AS oa
		 JOIN affiliations AS a ON a.id = oa.affiliation_id
		 ORDER BY a.name COLLATE NOCASE`,
	).all<OrganizationAffiliation & { organizationId: string }>();
	return organizations.map((organization) => ({
		...organization,
		affiliations: result.results
			.filter((item) => item.organizationId === organization.id)
			.map(({ organizationId: _organizationId, ...affiliation }) => affiliation),
	}));
}

async function requireOrganizationManager(
	env: Env,
	actor: AuthenticatedUser,
	organizationId: string,
) {
	const organization = await env.DB.prepare(
		`SELECT o.id, o.status,
		        (SELECT role FROM organization_memberships
		         WHERE organization_id = o.id AND user_id = ?1) AS organizationRole
		 FROM organizations AS o
		 WHERE o.id = ?2
		 LIMIT 1`,
	)
		.bind(actor.id, organizationId)
		.first<{
			id: string;
			status: OrganizationStatus;
			organizationRole: OrganizationRole | null;
		}>();
	if (!organization) throw new OrganizationMutationError("not-found");
	if (
		actor.siteRole !== "site_admin" &&
		(organization.status === "archived" || organization.organizationRole !== "org_admin")
	) {
		throw new OrganizationMutationError("forbidden");
	}
	return organization;
}

export async function listOrganizations(env: Env, includeInactive = false) {
	const result = await env.DB.prepare(
		`SELECT o.id,
		        o.name,
		        o.slug,
		        o.summary,
		        o.description,
		        o.website_url AS websiteUrl,
		        o.contact_email AS contactEmail,
		        o.logo_object_key AS logoObjectKey,
		        o.status,
		        o.created_at AS createdAt,
		        o.updated_at AS updatedAt,
		        count(om.user_id) AS memberCount
		 FROM organizations AS o
		 LEFT JOIN organization_memberships AS om ON om.organization_id = o.id
		 WHERE (?1 = 1 OR o.status = 'active')
		 GROUP BY o.id
		 ORDER BY
		   CASE o.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,
		   o.name COLLATE NOCASE`,
	)
		.bind(includeInactive ? 1 : 0)
		.all<OrganizationRow>();
	return attachAffiliations(env, result.results);
}

export async function listVisibleOrganizations(
	env: Env,
	viewer: AuthenticatedUser,
) {
	if (viewer.siteRole === "site_admin") return listOrganizations(env);
	const result = await env.DB.prepare(
		`WITH viewer_affiliations AS (
		   SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
		   UNION
		   SELECT oa.affiliation_id
		   FROM organization_memberships AS membership
		   JOIN organizations AS member_organization
		     ON member_organization.id = membership.organization_id
		    AND member_organization.status != 'archived'
		   JOIN organization_affiliations AS oa
		     ON oa.organization_id = membership.organization_id
		   WHERE membership.user_id = ?1
		 )
		 SELECT o.id, o.name, o.slug, o.summary, o.description,
		        o.website_url AS websiteUrl,
		        o.contact_email AS contactEmail,
		        o.logo_object_key AS logoObjectKey,
		        o.status, o.created_at AS createdAt, o.updated_at AS updatedAt,
		        (SELECT count(*) FROM organization_memberships WHERE organization_id = o.id) AS memberCount
		 FROM organizations AS o
		 WHERE o.status = 'active'
		   AND (
		     EXISTS (
		       SELECT 1 FROM organization_memberships
		       WHERE organization_id = o.id AND user_id = ?1
		     )
		     OR EXISTS (
		       SELECT 1
		       FROM organization_affiliations AS organization_affiliation
		       JOIN viewer_affiliations
		         ON viewer_affiliations.affiliation_id = organization_affiliation.affiliation_id
		       WHERE organization_affiliation.organization_id = o.id
		     )
		   )
		 ORDER BY o.name COLLATE NOCASE`,
	)
		.bind(viewer.id)
		.all<OrganizationRow>();
	return attachAffiliations(env, result.results);
}

export async function listManagedOrganizations(
	env: Env,
	viewer: AuthenticatedUser,
) {
	if (viewer.siteRole === "site_admin") return [];
	const result = await env.DB.prepare(
		`SELECT o.name, o.slug
		 FROM organization_memberships AS om
		 JOIN organizations AS o ON o.id = om.organization_id
		 WHERE om.user_id = ?1
		   AND om.role = 'org_admin'
		   AND o.status != 'archived'
		 ORDER BY o.name COLLATE NOCASE`,
	)
		.bind(viewer.id)
		.all<{ name: string; slug: string }>();
	return result.results;
}

export async function getOrganizationBySlug(
	env: Env,
	slug: string,
	viewer: AuthenticatedUser,
) {
	const organization = await env.DB.prepare(
		`SELECT o.id,
		        o.name,
		        o.slug,
		        o.summary,
		        o.description,
		        o.website_url AS websiteUrl,
		        o.contact_email AS contactEmail,
		        o.logo_object_key AS logoObjectKey,
		        o.status,
		        o.created_at AS createdAt,
		        o.updated_at AS updatedAt,
		        count(om.user_id) AS memberCount
		 FROM organizations AS o
		 LEFT JOIN organization_memberships AS om ON om.organization_id = o.id
		 WHERE o.slug = ?1
		 GROUP BY o.id
		 LIMIT 1`,
	)
		.bind(slug)
		.first<OrganizationRow>();
	if (!organization) return null;
	if (viewer.siteRole !== "site_admin") {
		const visible = await env.DB.prepare(
			`WITH viewer_affiliations AS (
			   SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
			   UNION
			   SELECT oa.affiliation_id
			   FROM organization_memberships AS membership
			   JOIN organizations AS member_organization
			     ON member_organization.id = membership.organization_id
			    AND member_organization.status != 'archived'
			   JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
			   WHERE membership.user_id = ?1
			 )
			 SELECT 1
			 FROM organizations AS o
			 WHERE o.id = ?2
			   AND o.status != 'archived'
			   AND (
			     EXISTS (
			       SELECT 1 FROM organization_memberships
			       WHERE organization_id = o.id AND user_id = ?1
			     )
			     OR (
			       o.status = 'active'
			       AND EXISTS (
			         SELECT 1
			         FROM organization_affiliations AS organization_affiliation
			         JOIN viewer_affiliations
			           ON viewer_affiliations.affiliation_id = organization_affiliation.affiliation_id
			         WHERE organization_affiliation.organization_id = o.id
			       )
			     )
			   )`,
		)
			.bind(viewer.id, organization.id)
			.first<number>("1");
		if (visible === null) return null;
	}

	const memberResult = await env.DB.prepare(
		`SELECT om.organization_id AS organizationId,
		        u.id AS userId,
		        u.name, u.avatar_object_key AS avatarObjectKey,
		        om.role,
		        om.created_at AS createdAt
		 FROM organization_memberships AS om
		 JOIN users AS u ON u.id = om.user_id
		 WHERE om.organization_id = ?1
		   AND u.status = 'active'
		   AND (?2 = 1 OR u.profile_visibility = 'members' OR u.id = ?3)
		 ORDER BY
		   CASE om.role WHEN 'org_admin' THEN 0 WHEN 'contributor' THEN 1 ELSE 2 END,
		   coalesce(u.name, u.email) COLLATE NOCASE`,
	)
		.bind(organization.id, viewer.siteRole === "site_admin" ? 1 : 0, viewer.id)
		.all<VisibleOrganizationMember>();

	const [organizationWithAffiliations] = await attachAffiliations(env, [organization]);
	return { organization: organizationWithAffiliations, members: memberResult.results };
}

export async function getOrganizationAdministrationData(env: Env) {
	const [organizations, membershipResult, memberResult] = await Promise.all([
		listOrganizations(env, true),
		env.DB.prepare(
			`SELECT om.organization_id AS organizationId,
			        u.id AS userId,
			        u.name,
			        u.email,
			        om.role,
			        om.created_at AS createdAt
			 FROM organization_memberships AS om
			 JOIN users AS u ON u.id = om.user_id
			 ORDER BY coalesce(u.name, u.email) COLLATE NOCASE`,
		).all<OrganizationMember>(),
		env.DB.prepare(
			`SELECT id, name, email
			 FROM users
			 WHERE status = 'active'
			 ORDER BY coalesce(name, email) COLLATE NOCASE`,
		).all<AvailableMember>(),
	]);

	return {
		organizations,
		memberships: membershipResult.results,
		availableMembers: memberResult.results,
	};
}

export async function getOrganizationManagementData(
	env: Env,
	actor: AuthenticatedUser,
	slug: string,
) {
	const visible = await getOrganizationBySlug(env, slug, actor);
	if (!visible?.organization) return null;
	await requireOrganizationManager(env, actor, visible.organization.id);

	const [membershipResult, memberResult] = await Promise.all([
		env.DB.prepare(
			`SELECT om.organization_id AS organizationId,
			        u.id AS userId, u.name, u.email, om.role,
			        om.created_at AS createdAt
			 FROM organization_memberships AS om
			 JOIN users AS u ON u.id = om.user_id
			 WHERE om.organization_id = ?1
			 ORDER BY
			   CASE om.role WHEN 'org_admin' THEN 0 WHEN 'contributor' THEN 1 ELSE 2 END,
			   coalesce(u.name, u.email) COLLATE NOCASE`,
		)
			.bind(visible.organization.id)
			.all<OrganizationMember>(),
		env.DB.prepare(
			`WITH target_affiliations AS (
			   SELECT affiliation_id
			   FROM organization_affiliations
			   WHERE organization_id = ?1
			 ),
			 effective AS (
			   SELECT user_id, affiliation_id FROM user_affiliations
			   UNION
			   SELECT om.user_id, oa.affiliation_id
			   FROM organization_memberships AS om
			   JOIN organizations AS o ON o.id = om.organization_id AND o.status != 'archived'
			   JOIN organization_affiliations AS oa ON oa.organization_id = om.organization_id
			 )
			 SELECT u.id, u.name, u.email
			 FROM users AS u
			 WHERE u.status = 'active'
			   AND (
			     ?2 = 1
			     OR EXISTS (
			       SELECT 1 FROM organization_memberships
			       WHERE organization_id = ?1 AND user_id = u.id
			     )
			     OR EXISTS (
			       SELECT 1
			       FROM effective
			       JOIN target_affiliations USING (affiliation_id)
			       WHERE effective.user_id = u.id
			     )
			   )
			 ORDER BY coalesce(u.name, u.email) COLLATE NOCASE`,
		)
			.bind(visible.organization.id, actor.siteRole === "site_admin" ? 1 : 0)
			.all<AvailableMember>(),
	]);

	return {
		organization: visible.organization,
		memberships: membershipResult.results,
		availableMembers: memberResult.results,
		canManageLifecycle: actor.siteRole === "site_admin",
	};
}

export async function createOrganization(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		name: string;
		slug: string;
		summary: string | null;
		websiteUrl: string | null;
		contactEmail: string | null;
	},
) {
	if (actor.siteRole !== "site_admin") {
		throw new OrganizationMutationError("forbidden");
	}
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	try {
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO organizations
				 (id, name, slug, summary, website_url, contact_email, status,
				  created_at, updated_at, event_scraping_enabled)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7, 0)`,
			).bind(
				id,
				input.name,
				input.slug,
				input.summary,
				input.websiteUrl,
				input.contactEmail,
				now,
			),
			env.DB.prepare(
				`INSERT INTO audit_log
				 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
				 VALUES (?1, ?2, 'organization.created', 'organization', ?3, ?4, ?5)`,
			).bind(
				crypto.randomUUID(),
				actor.id,
				id,
				JSON.stringify({ name: input.name, slug: input.slug }),
				now,
			),
		]);
	} catch (error) {
		if (error instanceof Error && error.message.includes("UNIQUE")) {
			throw new OrganizationMutationError("slug-conflict");
		}
		throw error;
	}
	return { id };
}

export async function updateOrganization(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		organizationId: string;
		name: string;
		slug: string;
		summary: string | null;
		description: string | null;
		websiteUrl: string | null;
		contactEmail: string | null;
		status: OrganizationStatus;
	},
) {
	await requireOrganizationManager(env, actor, input.organizationId);
	const now = new Date().toISOString();
	try {
		const results = await env.DB.batch([
			env.DB.prepare(
				`UPDATE organizations
				 SET name = ?1, slug = ?2, summary = ?3, description = ?4,
				     website_url = ?5, contact_email = ?6, status = ?7, updated_at = ?8
				 WHERE id = ?9`,
			).bind(
				input.name,
				input.slug,
				input.summary,
				input.description,
				input.websiteUrl,
				input.contactEmail,
				input.status,
				now,
				input.organizationId,
			),
			env.DB.prepare(
				`INSERT INTO audit_log
				 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
				 SELECT ?1, ?2, 'organization.updated', 'organization', ?3, ?4, ?5
				 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?3 AND updated_at = ?5)`,
			).bind(
				crypto.randomUUID(),
				actor.id,
				input.organizationId,
				JSON.stringify({ status: input.status, slug: input.slug }),
				now,
			),
		]);
		if (results[0]?.meta.changes !== 1) {
			throw new OrganizationMutationError("not-found");
		}
	} catch (error) {
		if (error instanceof OrganizationMutationError) throw error;
		if (error instanceof Error && error.message.includes("UNIQUE")) {
			throw new OrganizationMutationError("slug-conflict");
		}
		throw error;
	}
}

export async function updateManagedOrganizationProfile(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		organizationId: string;
		name: string;
		summary: string | null;
		description: string | null;
		websiteUrl: string | null;
		contactEmail: string | null;
	},
) {
	await requireOrganizationManager(env, actor, input.organizationId);
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE organizations
			 SET name = ?1, summary = ?2, description = ?3,
			     website_url = ?4, contact_email = ?5, updated_at = ?6
			 WHERE id = ?7 AND status != 'archived'`,
		).bind(
			input.name,
			input.summary,
			input.description,
			input.websiteUrl,
			input.contactEmail,
			now,
			input.organizationId,
		),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'organization.profile_updated', 'organization', ?3, ?4, ?5
			 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?3 AND updated_at = ?5)`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			input.organizationId,
			JSON.stringify({ name: input.name }),
			now,
		),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new OrganizationMutationError("not-found");
	}
}

export async function updateOrganizationLogo(
	env: Env,
	actor: AuthenticatedUser,
	input: { organizationId: string; logoObjectKey: string | null },
) {
	await requireOrganizationManager(env, actor, input.organizationId);
	const existing = await env.DB.prepare(
		"SELECT logo_object_key AS logoObjectKey FROM organizations WHERE id = ?1",
	).bind(input.organizationId).first<{ logoObjectKey: string | null }>();
	if (!existing) throw new OrganizationMutationError("not-found");
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE organizations
			 SET logo_object_key = ?1, updated_at = ?2
			 WHERE id = ?3 AND status != 'archived'`,
		).bind(input.logoObjectKey, now, input.organizationId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'organization.logo_updated', 'organization', ?3, ?4, ?5
			 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?3 AND updated_at = ?5)`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			input.organizationId,
			JSON.stringify({ hasLogo: input.logoObjectKey !== null }),
			now,
		),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new OrganizationMutationError("not-found");
	}
	return existing.logoObjectKey;
}

export async function setOrganizationMembership(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		organizationId: string;
		userId: string;
		role: OrganizationRole;
	},
) {
	await requireOrganizationManager(env, actor, input.organizationId);
	if (
		actor.siteRole !== "site_admin" &&
		input.userId === actor.id &&
		input.role !== "org_admin"
	) {
		throw new OrganizationMutationError("self-management");
	}
	const user = await env.DB.prepare(
		`WITH target_affiliations AS (
		   SELECT affiliation_id
		   FROM organization_affiliations
		   WHERE organization_id = ?1
		 ),
		 effective AS (
		   SELECT user_id, affiliation_id FROM user_affiliations
		   UNION
		   SELECT om.user_id, oa.affiliation_id
		   FROM organization_memberships AS om
		   JOIN organizations AS o ON o.id = om.organization_id AND o.status != 'archived'
		   JOIN organization_affiliations AS oa ON oa.organization_id = om.organization_id
		 )
		 SELECT u.id
		 FROM users AS u
		 WHERE u.id = ?2 AND u.status = 'active'
		   AND (
		     ?3 = 1
		     OR EXISTS (
		       SELECT 1 FROM organization_memberships
		       WHERE organization_id = ?1 AND user_id = u.id
		     )
		     OR EXISTS (
		       SELECT 1 FROM effective
		       JOIN target_affiliations USING (affiliation_id)
		       WHERE effective.user_id = u.id
		     )
		   )
		 LIMIT 1`,
	)
		.bind(input.organizationId, input.userId, actor.siteRole === "site_admin" ? 1 : 0)
		.first<{ id: string }>();
	if (!user) throw new OrganizationMutationError("member-unavailable");

	const existing = await env.DB.prepare(
		`SELECT role FROM organization_memberships
		 WHERE organization_id = ?1 AND user_id = ?2`,
	)
		.bind(input.organizationId, input.userId)
		.first<{ role: OrganizationRole }>();
	const now = new Date().toISOString();
	const action = existing
		? "organization.membership_role_changed"
		: "organization.membership_added";

	const results = await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO organization_memberships
			 (organization_id, user_id, role, created_at)
			 SELECT ?1, ?2, ?3, ?4
			 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?1 AND status != 'archived')
			 ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role`,
		).bind(input.organizationId, input.userId, input.role, now),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, ?3, 'organization', ?4, ?5, ?6
			 WHERE EXISTS (
			   SELECT 1 FROM organization_memberships
			   WHERE organization_id = ?4 AND user_id = ?7 AND role = ?8
			 )`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			action,
			input.organizationId,
			JSON.stringify({
				userId: input.userId,
				previousRole: existing?.role ?? null,
				role: input.role,
			}),
			now,
			input.userId,
			input.role,
		),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new OrganizationMutationError("not-found");
	}
}

export async function removeOrganizationMembership(
	env: Env,
	actor: AuthenticatedUser,
	input: { organizationId: string; userId: string },
) {
	await requireOrganizationManager(env, actor, input.organizationId);
	if (actor.siteRole !== "site_admin" && input.userId === actor.id) {
		throw new OrganizationMutationError("self-management");
	}
	const existing = await env.DB.prepare(
		`SELECT role FROM organization_memberships
		 WHERE organization_id = ?1 AND user_id = ?2`,
	)
		.bind(input.organizationId, input.userId)
		.first<{ role: OrganizationRole }>();
	if (!existing) {
		throw new OrganizationMutationError("membership-not-found");
	}
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`DELETE FROM organization_memberships
			 WHERE organization_id = ?1 AND user_id = ?2`,
		).bind(input.organizationId, input.userId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'organization.membership_removed', 'organization', ?3, ?4, ?5)`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			input.organizationId,
			JSON.stringify({ userId: input.userId, previousRole: existing.role }),
			now,
		),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new OrganizationMutationError("membership-not-found");
	}
}
