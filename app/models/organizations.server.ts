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
	status: OrganizationStatus;
	createdAt: string;
	updatedAt: string;
	memberCount: number;
};

export type OrganizationMember = {
	organizationId: string;
	userId: string;
	name: string | null;
	email: string;
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
			| "membership-not-found",
	) {
		super(reason);
		this.name = "OrganizationMutationError";
	}
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
		.all<OrganizationRecord>();
	return result.results;
}

export async function getOrganizationBySlug(env: Env, slug: string) {
	const organization = await env.DB.prepare(
		`SELECT o.id,
		        o.name,
		        o.slug,
		        o.summary,
		        o.description,
		        o.website_url AS websiteUrl,
		        o.contact_email AS contactEmail,
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
		.first<OrganizationRecord>();
	if (!organization) return null;

	const memberResult = await env.DB.prepare(
		`SELECT om.organization_id AS organizationId,
		        u.id AS userId,
		        u.name,
		        u.email,
		        om.role,
		        om.created_at AS createdAt
		 FROM organization_memberships AS om
		 JOIN users AS u ON u.id = om.user_id
		 WHERE om.organization_id = ?1 AND u.status = 'active'
		 ORDER BY
		   CASE om.role WHEN 'org_admin' THEN 0 WHEN 'contributor' THEN 1 ELSE 2 END,
		   coalesce(u.name, u.email) COLLATE NOCASE`,
	)
		.bind(organization.id)
		.all<OrganizationMember>();

	return { organization, members: memberResult.results };
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

export async function setOrganizationMembership(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		organizationId: string;
		userId: string;
		role: OrganizationRole;
	},
) {
	const user = await env.DB.prepare(
		`SELECT id FROM users WHERE id = ?1 AND status = 'active' LIMIT 1`,
	)
		.bind(input.userId)
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
