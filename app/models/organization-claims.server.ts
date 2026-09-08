import type { AuthenticatedUser } from "../lib/auth.server";
import type { OrganizationRole } from "../lib/organizations";

export type OrganizationClaimStatus = "pending" | "approved" | "rejected" | "cancelled";

export type OrganizationClaimRecord = {
	id: string;
	organizationId: string;
	organizationName: string;
	organizationSlug: string;
	organizationLogoObjectKey: string | null;
	userId: string;
	userName: string | null;
	userEmail: string;
	requestedRole: OrganizationRole;
	currentRole: OrganizationRole | null;
	status: OrganizationClaimStatus;
	reviewReason: string | null;
	createdAt: string;
	updatedAt: string;
};

export class OrganizationClaimMutationError extends Error {
	constructor(public readonly reason:
		| "organization-unavailable"
		| "same-role"
		| "already-pending"
		| "claim-unavailable"
		| "already-reviewed"
		| "forbidden"
		| "self-review"
		| "member-unavailable"
	) {
		super(reason);
		this.name = "OrganizationClaimMutationError";
	}
}

const claimSelection = `SELECT claim.id,
	claim.organization_id AS organizationId,
	o.name AS organizationName,
	o.slug AS organizationSlug,
	o.logo_object_key AS organizationLogoObjectKey,
	claim.user_id AS userId,
	u.name AS userName,
	u.email AS userEmail,
	claim.requested_role AS requestedRole,
	(SELECT role FROM organization_memberships
	 WHERE organization_id = claim.organization_id AND user_id = claim.user_id) AS currentRole,
	claim.status,
	claim.review_reason AS reviewReason,
	claim.created_at AS createdAt,
	claim.updated_at AS updatedAt
	FROM organization_membership_claims AS claim
	JOIN organizations AS o ON o.id = claim.organization_id
	JOIN users AS u ON u.id = claim.user_id`;

export async function listClaimableOrganizations(env: Env, actor: AuthenticatedUser) {
	const result = await env.DB.prepare(
		`WITH actor_affiliations AS (
		   SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
		   UNION
		   SELECT oa.affiliation_id
		   FROM organization_memberships AS membership
		   JOIN organizations AS member_organization
		     ON member_organization.id = membership.organization_id AND member_organization.status != 'archived'
		   JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
		   WHERE membership.user_id = ?1
		 )
		 SELECT o.id, o.name, o.slug, o.logo_object_key AS logoObjectKey,
		        om.role AS currentRole,
		        EXISTS (
		          SELECT 1 FROM organization_membership_claims
		          WHERE organization_id = o.id AND user_id = ?1 AND status = 'pending'
		        ) AS hasPendingClaim
		 FROM organizations AS o
		 LEFT JOIN organization_memberships AS om
		   ON om.organization_id = o.id AND om.user_id = ?1
		 WHERE o.status = 'active'
		   AND (?2 = 1 OR om.user_id IS NOT NULL OR EXISTS (
		     SELECT 1 FROM organization_affiliations AS organization_affiliation
		     JOIN actor_affiliations ON actor_affiliations.affiliation_id = organization_affiliation.affiliation_id
		     WHERE organization_affiliation.organization_id = o.id
		   ))
		 ORDER BY o.name COLLATE NOCASE`,
	)
		.bind(actor.id, actor.siteRole === "site_admin" ? 1 : 0)
		.all<{
			id: string;
			name: string;
			slug: string;
			logoObjectKey: string | null;
			currentRole: OrganizationRole | null;
			hasPendingClaim: number;
		}>();
	return result.results.map((organization) => ({
		...organization,
		hasPendingClaim: organization.hasPendingClaim === 1,
	}));
}

export async function listOwnOrganizationClaims(env: Env, actor: AuthenticatedUser) {
	const result = await env.DB.prepare(
		`${claimSelection}
		 WHERE claim.user_id = ?1
		 ORDER BY CASE claim.status WHEN 'pending' THEN 0 ELSE 1 END,
		          claim.updated_at DESC, claim.id DESC
		 LIMIT 50`,
	).bind(actor.id).all<OrganizationClaimRecord>();
	return result.results;
}

export async function submitOrganizationClaim(
	env: Env,
	actor: AuthenticatedUser,
	input: { organizationId: string; requestedRole: OrganizationRole },
) {
	const organization = await env.DB.prepare(
		`WITH actor_affiliations AS (
		   SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
		   UNION
		   SELECT oa.affiliation_id
		   FROM organization_memberships AS membership
		   JOIN organizations AS member_organization
		     ON member_organization.id = membership.organization_id AND member_organization.status != 'archived'
		   JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
		   WHERE membership.user_id = ?1
		 )
		 SELECT o.id,
		        (SELECT role FROM organization_memberships
		         WHERE organization_id = o.id AND user_id = ?1) AS currentRole,
		        EXISTS (
		          SELECT 1 FROM organization_membership_claims
		          WHERE organization_id = o.id AND user_id = ?1 AND status = 'pending'
		        ) AS hasPendingClaim
		 FROM organizations AS o
		 WHERE o.id = ?2 AND o.status = 'active'
		   AND (?3 = 1 OR EXISTS (
		     SELECT 1 FROM organization_memberships WHERE organization_id = o.id AND user_id = ?1
		   ) OR EXISTS (
		     SELECT 1 FROM organization_affiliations AS organization_affiliation
		     JOIN actor_affiliations ON actor_affiliations.affiliation_id = organization_affiliation.affiliation_id
		     WHERE organization_affiliation.organization_id = o.id
		   ))`,
	)
		.bind(actor.id, input.organizationId, actor.siteRole === "site_admin" ? 1 : 0)
		.first<{ id: string; currentRole: OrganizationRole | null; hasPendingClaim: number }>();
	if (!organization) throw new OrganizationClaimMutationError("organization-unavailable");
	if (organization.currentRole === input.requestedRole) throw new OrganizationClaimMutationError("same-role");
	if (organization.hasPendingClaim === 1) throw new OrganizationClaimMutationError("already-pending");

	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	try {
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO organization_membership_claims
				 (id, organization_id, user_id, requested_role, status, created_at, updated_at)
				 SELECT ?1, ?2, ?3, ?4, 'pending', ?5, ?5
				 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?2 AND status = 'active')
				   AND EXISTS (SELECT 1 FROM users WHERE id = ?3 AND status = 'active')`,
			).bind(id, input.organizationId, actor.id, input.requestedRole, now),
			env.DB.prepare(
				`INSERT INTO audit_log
				 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
				 SELECT ?1, ?2, 'organization.claim_submitted', 'organization_claim', ?3, ?4, ?5
				 WHERE EXISTS (
				   SELECT 1 FROM organization_membership_claims WHERE id = ?3 AND status = 'pending'
				 )`,
			).bind(crypto.randomUUID(), actor.id, id, JSON.stringify({
				organizationId: input.organizationId,
				requestedRole: input.requestedRole,
				previousRole: organization.currentRole,
			}), now),
		]);
	} catch (error) {
		if (error instanceof Error && error.message.includes("UNIQUE")) {
			throw new OrganizationClaimMutationError("already-pending");
		}
		throw error;
	}
	return { id };
}

export async function cancelOrganizationClaim(env: Env, actor: AuthenticatedUser, claimId: string) {
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE organization_membership_claims
			 SET status = 'cancelled', updated_at = ?1
			 WHERE id = ?2 AND user_id = ?3 AND status = 'pending'`,
		).bind(now, claimId, actor.id),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'organization.claim_cancelled', 'organization_claim', ?3, NULL, ?4
			 WHERE EXISTS (
			   SELECT 1 FROM organization_membership_claims
			   WHERE id = ?3 AND user_id = ?2 AND status = 'cancelled' AND updated_at = ?4
			 )`,
		).bind(crypto.randomUUID(), actor.id, claimId, now),
	]);
	if (results[0]?.meta.changes !== 1) throw new OrganizationClaimMutationError("claim-unavailable");
}

export async function listReviewableOrganizationClaims(
	env: Env,
	actor: AuthenticatedUser,
	organizationId?: string,
) {
	const result = await env.DB.prepare(
		`${claimSelection}
		 WHERE claim.status = 'pending'
		   AND (?2 IS NULL OR claim.organization_id = ?2)
		   AND (?3 = 1 OR EXISTS (
		     SELECT 1 FROM organization_memberships AS reviewer_membership
		     WHERE reviewer_membership.organization_id = claim.organization_id
		       AND reviewer_membership.user_id = ?1
		       AND reviewer_membership.role = 'org_admin'
		   ))
		 ORDER BY claim.created_at ASC, claim.id ASC`,
	)
		.bind(actor.id, organizationId ?? null, actor.siteRole === "site_admin" ? 1 : 0)
		.all<OrganizationClaimRecord>();
	return result.results;
}

export async function reviewOrganizationClaim(
	env: Env,
	actor: AuthenticatedUser,
	input: { claimId: string; decision: "approve" | "reject"; reason: string | null },
) {
	const claim = await env.DB.prepare(
		`${claimSelection}
		 WHERE claim.id = ?1
		 LIMIT 1`,
	).bind(input.claimId).first<OrganizationClaimRecord>();
	if (!claim) throw new OrganizationClaimMutationError("claim-unavailable");
	if (claim.status !== "pending") throw new OrganizationClaimMutationError("already-reviewed");
	if (claim.userId === actor.id) throw new OrganizationClaimMutationError("self-review");
	const canReview = actor.siteRole === "site_admin" || (await env.DB.prepare(
		`SELECT 1 FROM organization_memberships
		 WHERE organization_id = ?1 AND user_id = ?2 AND role = 'org_admin'`,
	).bind(claim.organizationId, actor.id).first<number>("1")) !== null;
	if (!canReview) throw new OrganizationClaimMutationError("forbidden");
	if (input.decision === "reject" && (!input.reason || input.reason.trim().length < 3)) {
		throw new OrganizationClaimMutationError("claim-unavailable");
	}
	if (input.decision === "approve") {
		const available = await env.DB.prepare(
			`SELECT 1 FROM users AS u, organizations AS o
			 WHERE u.id = ?1 AND u.status = 'active'
			   AND o.id = ?2 AND o.status = 'active'`,
		).bind(claim.userId, claim.organizationId).first<number>("1");
		if (available === null) throw new OrganizationClaimMutationError("member-unavailable");
	}

	const now = new Date().toISOString();
	const nextStatus = input.decision === "approve" ? "approved" : "rejected";
	const notificationBody = input.decision === "approve"
		? `Your ${claim.organizationName} membership claim was approved.`
		: `Your ${claim.organizationName} membership claim was not approved.${input.reason ? ` ${input.reason}` : ""}`;
	const results = await env.DB.batch([
		...(input.decision === "approve" ? [env.DB.prepare(
			`INSERT INTO organization_memberships (organization_id, user_id, role, created_at)
			 SELECT organization_id, user_id, requested_role, ?1
			 FROM organization_membership_claims
			 WHERE id = ?2 AND status = 'pending'
			 ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role`,
		).bind(now, claim.id)] : []),
		env.DB.prepare(
			`UPDATE organization_membership_claims
			 SET status = ?1, reviewed_by_user_id = ?2, reviewed_at = ?3,
			     review_reason = ?4, updated_at = ?3
			 WHERE id = ?5 AND status = 'pending'`,
		).bind(nextStatus, actor.id, now, input.reason, claim.id),
		env.DB.prepare(
			`INSERT INTO notifications
			 (id, user_id, actor_user_id, post_id, comment_id, type, body, read_at, created_at)
			 SELECT ?1, user_id, ?2, NULL, NULL, 'approval', ?3, NULL, ?4
			 FROM organization_membership_claims
			 WHERE id = ?5 AND status = ?6 AND reviewed_by_user_id = ?2 AND reviewed_at = ?4`,
		).bind(crypto.randomUUID(), actor.id, notificationBody, now, claim.id, nextStatus),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, ?3, 'organization_claim', ?4, ?5, ?6
			 WHERE EXISTS (
			   SELECT 1 FROM organization_membership_claims
			   WHERE id = ?4 AND status = ?7 AND reviewed_by_user_id = ?2 AND reviewed_at = ?6
			 )`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			`organization.claim_${nextStatus}`,
			claim.id,
			JSON.stringify({
				organizationId: claim.organizationId,
				userId: claim.userId,
				previousRole: claim.currentRole,
				requestedRole: claim.requestedRole,
				reason: input.reason,
			}),
			now,
			nextStatus,
		),
	]);
	const reviewResultIndex = input.decision === "approve" ? 1 : 0;
	if (results[reviewResultIndex]?.meta.changes !== 1) {
		throw new OrganizationClaimMutationError("already-reviewed");
	}
	return nextStatus;
}
