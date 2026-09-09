import type { AuthenticatedUser } from "../lib/auth.server";
import type {
	DirectoryStatus,
	OrganizationRole,
	OrganizationStatus,
} from "../lib/organizations";

export type OrganizationRecord = {
	id: string;
	name: string;
	slug: string;
	summary: string | null;
	description: string | null;
	category: string | null;
	websiteUrl: string | null;
	eventSourceUrl: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
	townCity: string | null;
	region: string | null;
	socialPlatform: string | null;
	socialHandle: string | null;
	listingRationale: string | null;
	leadershipIdentity: string | null;
	sourceImageUrls: string | null;
	operatesStatewide: number | null;
	logoObjectKey: string | null;
	status: OrganizationStatus;
	directoryStatus: DirectoryStatus;
	directoryRequestedAt: string | null;
	directoryReviewedAt: string | null;
	directoryReviewNote: string | null;
	directoryPublishedAt: string | null;
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

export type DirectoryReviewRecord = OrganizationRecord & {
	requesterName: string | null;
	requesterEmail: string | null;
};

export class OrganizationMutationError extends Error {
	constructor(
		public readonly reason:
			| "not-found"
			| "slug-conflict"
			| "member-unavailable"
			| "membership-not-found"
			| "forbidden"
			| "self-management"
			| "directory-transition",
	) {
		super(reason);
		this.name = "OrganizationMutationError";
	}
}

type OrganizationRow = Omit<OrganizationRecord, "affiliations">;

async function attachAffiliations(
	env: Env,
	organizations: OrganizationRow[],
	viewer?: AuthenticatedUser,
) {
	if (organizations.length === 0) return [];
	const statement = viewer ? env.DB.prepare(
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
		 SELECT oa.organization_id AS organizationId,
		        a.id, a.name, a.slug
		 FROM organization_affiliations AS oa
		 JOIN affiliations AS a ON a.id = oa.affiliation_id
		 JOIN viewer_affiliations ON viewer_affiliations.affiliation_id = a.id
		 ORDER BY a.name COLLATE NOCASE`,
	).bind(viewer.id) : env.DB.prepare(
		`SELECT oa.organization_id AS organizationId,
		        a.id, a.name, a.slug
		 FROM organization_affiliations AS oa
		 JOIN affiliations AS a ON a.id = oa.affiliation_id
		 ORDER BY a.name COLLATE NOCASE`,
	);
	const result = await statement.all<OrganizationAffiliation & { organizationId: string }>();
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
		        o.category,
		        o.website_url AS websiteUrl,
		        o.event_source_url AS eventSourceUrl,
		        o.contact_email AS contactEmail,
		        o.contact_phone AS contactPhone,
		        o.town_city AS townCity,
		        o.region,
		        o.social_platform AS socialPlatform,
		        o.social_handle AS socialHandle,
		        o.listing_rationale AS listingRationale,
		        o.leadership_identity AS leadershipIdentity,
		        o.source_image_urls AS sourceImageUrls,
		        o.operates_statewide AS operatesStatewide,
		        o.logo_object_key AS logoObjectKey,
		        o.status,
		        o.directory_status AS directoryStatus,
		        o.directory_requested_at AS directoryRequestedAt,
		        o.directory_reviewed_at AS directoryReviewedAt,
		        o.directory_review_note AS directoryReviewNote,
		        o.directory_published_at AS directoryPublishedAt,
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
	const organizations = await listOrganizations(env);
	return attachAffiliations(
		env,
		organizations.map(({ affiliations: _affiliations, ...organization }) => organization),
		viewer,
	);
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
		        o.category,
		        o.website_url AS websiteUrl,
		        o.event_source_url AS eventSourceUrl,
		        o.contact_email AS contactEmail,
		        o.contact_phone AS contactPhone,
		        o.town_city AS townCity,
		        o.region,
		        o.social_platform AS socialPlatform,
		        o.social_handle AS socialHandle,
		        o.listing_rationale AS listingRationale,
		        o.leadership_identity AS leadershipIdentity,
		        o.source_image_urls AS sourceImageUrls,
		        o.operates_statewide AS operatesStatewide,
		        o.logo_object_key AS logoObjectKey,
		        o.status,
		        o.directory_status AS directoryStatus,
		        o.directory_requested_at AS directoryRequestedAt,
		        o.directory_reviewed_at AS directoryReviewedAt,
		        o.directory_review_note AS directoryReviewNote,
		        o.directory_published_at AS directoryPublishedAt,
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
	if (viewer.siteRole !== "site_admin" && organization.status !== "active") {
		const visible = await env.DB.prepare(
			`SELECT 1 FROM organization_memberships
			 WHERE organization_id = ?2 AND user_id = ?1
			   AND EXISTS (
			     SELECT 1 FROM organizations WHERE id = ?2 AND status != 'archived'
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

	const [organizationWithAffiliations] = await attachAffiliations(env, [organization], viewer);
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

export async function listDirectoryReviewQueue(env: Env) {
	const result = await env.DB.prepare(
		`SELECT o.id, o.name, o.slug, o.summary, o.description, o.category,
		        o.website_url AS websiteUrl, o.event_source_url AS eventSourceUrl,
		        o.contact_email AS contactEmail,
		        o.contact_phone AS contactPhone, o.town_city AS townCity, o.region,
		        o.social_platform AS socialPlatform, o.social_handle AS socialHandle,
		        o.listing_rationale AS listingRationale,
		        o.leadership_identity AS leadershipIdentity,
		        o.source_image_urls AS sourceImageUrls,
		        o.operates_statewide AS operatesStatewide,
		        o.logo_object_key AS logoObjectKey, o.status,
		        o.directory_status AS directoryStatus,
		        o.directory_requested_at AS directoryRequestedAt,
		        o.directory_reviewed_at AS directoryReviewedAt,
		        o.directory_review_note AS directoryReviewNote,
		        o.directory_published_at AS directoryPublishedAt,
		        o.created_at AS createdAt, o.updated_at AS updatedAt,
		        (SELECT count(*) FROM organization_memberships WHERE organization_id = o.id) AS memberCount,
		        u.name AS requesterName, u.email AS requesterEmail
		 FROM organizations AS o
		 LEFT JOIN users AS u ON u.id = o.directory_requested_by_user_id
		 WHERE o.directory_status = 'pending'
		 ORDER BY o.directory_requested_at ASC, o.name COLLATE NOCASE`,
	).all<Omit<DirectoryReviewRecord, "affiliations">>();
	const withAffiliations = await attachAffiliations(env, result.results);
	return withAffiliations as DirectoryReviewRecord[];
}

export async function requestDirectoryParticipation(
	env: Env,
	actor: AuthenticatedUser,
	organizationId: string,
) {
	await requireOrganizationManager(env, actor, organizationId);
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE organizations
			 SET directory_status = 'pending', directory_requested_by_user_id = ?1,
			     directory_requested_at = ?2, directory_reviewed_by_user_id = NULL,
			     directory_reviewed_at = NULL, directory_review_note = NULL, updated_at = ?2
			 WHERE id = ?3 AND status = 'active'
			   AND directory_status IN ('not_listed', 'rejected', 'opted_out')`,
		).bind(actor.id, now, organizationId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'organization.directory_requested', 'organization', ?3, NULL, ?4
			 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?3 AND directory_status = 'pending' AND updated_at = ?4)`,
		).bind(crypto.randomUUID(), actor.id, organizationId, now),
	]);
	if (results[0]?.meta.changes !== 1) throw new OrganizationMutationError("directory-transition");
}

export async function withdrawDirectoryParticipation(
	env: Env,
	actor: AuthenticatedUser,
	organizationId: string,
) {
	await requireOrganizationManager(env, actor, organizationId);
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE organizations
			 SET directory_status = 'opted_out', directory_reviewed_by_user_id = NULL,
			     directory_reviewed_at = NULL, directory_review_note = NULL,
			     directory_published_at = NULL, updated_at = ?1
			 WHERE id = ?2 AND status != 'archived'
			   AND directory_status IN ('pending', 'published', 'rejected')`,
		).bind(now, organizationId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'organization.directory_withdrawn', 'organization', ?3, NULL, ?4
			 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?3 AND directory_status = 'opted_out' AND updated_at = ?4)`,
		).bind(crypto.randomUUID(), actor.id, organizationId, now),
	]);
	if (results[0]?.meta.changes !== 1) throw new OrganizationMutationError("directory-transition");
}

export async function reviewDirectoryParticipation(
	env: Env,
	actor: AuthenticatedUser,
	input: { organizationId: string; decision: "approve" | "reject"; note: string | null },
) {
	if (actor.siteRole !== "site_admin") throw new OrganizationMutationError("forbidden");
	const now = new Date().toISOString();
	const status = input.decision === "approve" ? "published" : "rejected";
	const existing = await env.DB.prepare(
		`SELECT directory_requested_by_user_id AS requesterUserId
		 FROM organizations WHERE id = ?1 AND directory_status = 'pending'`,
	).bind(input.organizationId).first<{ requesterUserId: string | null }>();
	if (!existing) throw new OrganizationMutationError("directory-transition");
	const statements = [
		env.DB.prepare(
			`UPDATE organizations
			 SET directory_status = ?1, directory_reviewed_by_user_id = ?2,
			     directory_reviewed_at = ?3, directory_review_note = ?4,
			     directory_published_at = CASE WHEN ?1 = 'published' THEN ?3 ELSE NULL END,
			     updated_at = ?3
			 WHERE id = ?5 AND directory_status = 'pending'`,
		).bind(status, actor.id, now, input.note, input.organizationId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, ?3, 'organization', ?4, ?5, ?6
			 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?4 AND directory_status = ?7 AND updated_at = ?6)`,
		).bind(
			crypto.randomUUID(), actor.id,
			input.decision === "approve" ? "organization.directory_approved" : "organization.directory_rejected",
			input.organizationId, JSON.stringify({ note: input.note }), now, status,
		),
	];
	if (existing.requesterUserId) {
		statements.push(env.DB.prepare(
			`INSERT INTO notifications
			 (id, user_id, actor_user_id, post_id, comment_id, type, body, read_at, created_at)
			 SELECT ?1, ?2, ?3, NULL, NULL, 'approval',
			        CASE WHEN ?4 = 'published'
			          THEN 'Your organization is now approved for the NH Connect public directory.'
			          ELSE 'Your NH Connect public directory request needs changes.' END,
			        NULL, ?5
			 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2 AND status = 'active')`,
		).bind(crypto.randomUUID(), existing.requesterUserId, actor.id, status, now));
	}
	const results = await env.DB.batch(statements);
	if (results[0]?.meta.changes !== 1) throw new OrganizationMutationError("directory-transition");
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
		description?: string | null;
		category?: string | null;
		websiteUrl: string | null;
		eventSourceUrl?: string | null;
		contactEmail: string | null;
		contactPhone?: string | null;
		townCity?: string | null;
		region?: string | null;
		socialPlatform?: string | null;
		socialHandle?: string | null;
		listingRationale?: string | null;
		leadershipIdentity?: string | null;
		sourceImageUrls?: string | null;
		operatesStatewide?: number | null;
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
				 (id, name, slug, summary, description, category, website_url, contact_email,
				  contact_phone, town_city, region, social_platform, social_handle, event_source_url,
				  listing_rationale, leadership_identity, source_image_urls, operates_statewide,
				  status, created_at, updated_at, event_scraping_enabled)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
				  ?14, ?15, ?16, ?17, ?18, 'active', ?19, ?19, 0)`,
			).bind(
				id,
				input.name,
				input.slug,
				input.summary,
				input.description ?? null,
				input.category ?? null,
				input.websiteUrl,
				input.contactEmail,
				input.contactPhone ?? null,
				input.townCity ?? null,
				input.region ?? null,
				input.socialPlatform ?? null,
				input.socialHandle ?? null,
				input.eventSourceUrl ?? null,
				input.listingRationale ?? null,
				input.leadershipIdentity ?? null,
				input.sourceImageUrls ?? null,
				input.operatesStatewide ?? null,
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
		category?: string | null;
		websiteUrl: string | null;
		eventSourceUrl?: string | null;
		contactEmail: string | null;
		contactPhone?: string | null;
		townCity?: string | null;
		region?: string | null;
		socialPlatform?: string | null;
		socialHandle?: string | null;
		listingRationale?: string | null;
		leadershipIdentity?: string | null;
		sourceImageUrls?: string | null;
		operatesStatewide?: number | null;
		status: OrganizationStatus;
	},
) {
	await requireOrganizationManager(env, actor, input.organizationId);
	const now = new Date().toISOString();
	try {
		const results = await env.DB.batch([
			env.DB.prepare(
				`UPDATE organizations
				 SET name = ?1, slug = ?2, summary = ?3, description = ?4, category = ?5,
				     website_url = ?6, contact_email = ?7, contact_phone = ?8,
				     town_city = ?9, region = ?10, social_platform = ?11, social_handle = ?12,
				     event_source_url = ?13, listing_rationale = ?14, leadership_identity = ?15,
				     source_image_urls = ?16, operates_statewide = ?17,
				     status = ?18, updated_at = ?19
				 WHERE id = ?20`,
			).bind(
				input.name,
				input.slug,
				input.summary,
				input.description,
				input.category ?? null,
				input.websiteUrl,
				input.contactEmail,
				input.contactPhone ?? null,
				input.townCity ?? null,
				input.region ?? null,
				input.socialPlatform ?? null,
				input.socialHandle ?? null,
				input.eventSourceUrl ?? null,
				input.listingRationale ?? null,
				input.leadershipIdentity ?? null,
				input.sourceImageUrls ?? null,
				input.operatesStatewide ?? null,
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
		category?: string | null;
		websiteUrl: string | null;
		eventSourceUrl?: string | null;
		contactEmail: string | null;
		contactPhone?: string | null;
		townCity?: string | null;
		region?: string | null;
		socialPlatform?: string | null;
		socialHandle?: string | null;
		listingRationale?: string | null;
		leadershipIdentity?: string | null;
		sourceImageUrls?: string | null;
		operatesStatewide?: number | null;
	},
) {
	await requireOrganizationManager(env, actor, input.organizationId);
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE organizations
			 SET name = ?1, summary = ?2, description = ?3, category = ?4,
			     website_url = ?5, contact_email = ?6, contact_phone = ?7,
			     town_city = ?8, region = ?9, social_platform = ?10, social_handle = ?11,
			     event_source_url = ?12, listing_rationale = ?13, leadership_identity = ?14,
			     source_image_urls = ?15, operates_statewide = ?16, updated_at = ?17
			 WHERE id = ?18 AND status != 'archived'`,
		).bind(
			input.name,
			input.summary,
			input.description,
			input.category ?? null,
			input.websiteUrl,
			input.contactEmail,
			input.contactPhone ?? null,
			input.townCity ?? null,
			input.region ?? null,
			input.socialPlatform ?? null,
			input.socialHandle ?? null,
			input.eventSourceUrl ?? null,
			input.listingRationale ?? null,
			input.leadershipIdentity ?? null,
			input.sourceImageUrls ?? null,
			input.operatesStatewide ?? null,
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
			`UPDATE organization_membership_claims
			 SET status = 'approved', reviewed_by_user_id = ?1, reviewed_at = ?2,
			     review_reason = 'Resolved through direct membership management.', updated_at = ?2
			 WHERE organization_id = ?3 AND user_id = ?4 AND status = 'pending'`,
		).bind(actor.id, now, input.organizationId, input.userId),
		env.DB.prepare(
			`INSERT INTO notifications
			 (id, user_id, actor_user_id, post_id, comment_id, type, body, read_at, created_at)
			 SELECT ?1, claim.user_id, ?2, NULL, NULL, 'approval',
			        'Your ' || o.name || ' membership claim was approved.', NULL, ?3
			 FROM organization_membership_claims AS claim
			 JOIN organizations AS o ON o.id = claim.organization_id
			 WHERE claim.organization_id = ?4 AND claim.user_id = ?5
			   AND claim.status = 'approved' AND claim.reviewed_by_user_id = ?2 AND claim.reviewed_at = ?3`,
		).bind(crypto.randomUUID(), actor.id, now, input.organizationId, input.userId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'organization.claim_approved', 'organization_claim', claim.id, ?3, ?4
			 FROM organization_membership_claims AS claim
			 WHERE claim.organization_id = ?5 AND claim.user_id = ?6
			   AND claim.status = 'approved' AND claim.reviewed_by_user_id = ?2 AND claim.reviewed_at = ?4`,
		).bind(crypto.randomUUID(), actor.id, JSON.stringify({
			organizationId: input.organizationId,
			userId: input.userId,
			previousRole: existing?.role ?? null,
			requestedRole: input.role,
			directMembershipManagement: true,
		}), now, input.organizationId, input.userId),
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

export async function deleteOrganization(
	env: Env,
	actor: AuthenticatedUser,
	organizationId: string,
) {
	if (actor.siteRole !== "site_admin") {
		throw new OrganizationMutationError("forbidden");
	}
	const session = env.DB.withSession("first-primary");
	const organization = await session.prepare(
		`SELECT id, name, slug, logo_object_key AS logoObjectKey
		 FROM organizations
		 WHERE id = ?1
		 LIMIT 1`,
	).bind(organizationId).first<{
		id: string;
		name: string;
		slug: string;
		logoObjectKey: string | null;
	}>();
	if (!organization) throw new OrganizationMutationError("not-found");

	const now = new Date().toISOString();
	const results = await session.batch([
		session.prepare("DELETE FROM organizations WHERE id = ?1").bind(organization.id),
		session.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'organization.deleted', 'organization', ?3, ?4, ?5
			 WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = ?3)`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			organization.id,
			JSON.stringify({ name: organization.name, slug: organization.slug }),
			now,
		),
		]);
	if (!results[0] || results[0].meta.changes < 1) {
		throw new OrganizationMutationError("not-found");
	}
	return { logoObjectKey: organization.logoObjectKey };
}
