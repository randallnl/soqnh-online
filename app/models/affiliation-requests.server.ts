import type { AuthenticatedUser } from "../lib/auth.server";

export type AffiliationRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type AffiliationMembershipRequest = {
	id: string;
	affiliationId: string;
	affiliationName: string;
	userId: string;
	userName: string | null;
	userEmail: string;
	status: AffiliationRequestStatus;
	reviewReason: string | null;
	createdAt: string;
	updatedAt: string;
};

export class AffiliationRequestMutationError extends Error {
	constructor(public readonly reason:
		| "affiliation-unavailable"
		| "already-member"
		| "already-pending"
		| "request-unavailable"
		| "already-reviewed"
		| "forbidden"
		| "self-review"
		| "member-unavailable"
	) {
		super(reason);
		this.name = "AffiliationRequestMutationError";
	}
}

const requestSelection = `SELECT request.id,
	request.affiliation_id AS affiliationId,
	a.name AS affiliationName,
	request.user_id AS userId,
	u.name AS userName,
	u.email AS userEmail,
	request.status,
	request.review_reason AS reviewReason,
	request.created_at AS createdAt,
	request.updated_at AS updatedAt
	FROM affiliation_membership_requests AS request
	JOIN affiliations AS a ON a.id = request.affiliation_id
	JOIN users AS u ON u.id = request.user_id`;

export async function listRequestableAffiliations(env: Env, actor: AuthenticatedUser) {
	const result = await env.DB.prepare(
		`SELECT a.id, a.name, a.slug,
		        EXISTS (SELECT 1 FROM user_affiliations WHERE user_id = ?1 AND affiliation_id = a.id) AS hasDirectAccess,
		        (EXISTS (SELECT 1 FROM user_affiliations WHERE user_id = ?1 AND affiliation_id = a.id)
		          OR EXISTS (
		            SELECT 1 FROM organization_memberships AS membership
		            JOIN organizations AS o ON o.id = membership.organization_id AND o.status != 'archived'
		            JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
		            WHERE membership.user_id = ?1 AND oa.affiliation_id = a.id
		          )) AS hasEffectiveAccess,
		        EXISTS (
		          SELECT 1 FROM affiliation_membership_requests
		          WHERE affiliation_id = a.id AND user_id = ?1 AND status = 'pending'
		        ) AS hasPendingRequest
		 FROM affiliations AS a
		 ORDER BY a.name COLLATE NOCASE`,
	).bind(actor.id).all<{
		id: string;
		name: string;
		slug: string;
		hasDirectAccess: number;
		hasEffectiveAccess: number;
		hasPendingRequest: number;
	}>();
	return result.results.map((affiliation) => ({
		...affiliation,
		hasDirectAccess: affiliation.hasDirectAccess === 1,
		hasEffectiveAccess: affiliation.hasEffectiveAccess === 1,
		hasPendingRequest: affiliation.hasPendingRequest === 1,
	}));
}

export async function listOwnAffiliationRequests(env: Env, actor: AuthenticatedUser) {
	const result = await env.DB.prepare(
		`${requestSelection}
		 WHERE request.user_id = ?1
		 ORDER BY CASE request.status WHEN 'pending' THEN 0 ELSE 1 END,
		          request.updated_at DESC, request.id DESC
		 LIMIT 50`,
	).bind(actor.id).all<AffiliationMembershipRequest>();
	return result.results;
}

export async function submitAffiliationRequest(env: Env, actor: AuthenticatedUser, affiliationId: string) {
	const affiliation = await env.DB.prepare(
		`SELECT a.id,
		        (EXISTS (SELECT 1 FROM user_affiliations WHERE user_id = ?1 AND affiliation_id = a.id)
		          OR EXISTS (
		            SELECT 1 FROM organization_memberships AS membership
		            JOIN organizations AS o ON o.id = membership.organization_id AND o.status != 'archived'
		            JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
		            WHERE membership.user_id = ?1 AND oa.affiliation_id = a.id
		          )) AS hasEffectiveAccess,
		        EXISTS (
		          SELECT 1 FROM affiliation_membership_requests
		          WHERE affiliation_id = a.id AND user_id = ?1 AND status = 'pending'
		        ) AS hasPendingRequest
		 FROM affiliations AS a WHERE a.id = ?2`,
	).bind(actor.id, affiliationId).first<{ id: string; hasEffectiveAccess: number; hasPendingRequest: number }>();
	if (!affiliation) throw new AffiliationRequestMutationError("affiliation-unavailable");
	if (affiliation.hasEffectiveAccess === 1) throw new AffiliationRequestMutationError("already-member");
	if (affiliation.hasPendingRequest === 1) throw new AffiliationRequestMutationError("already-pending");

	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	try {
		const results = await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO affiliation_membership_requests
				 (id, affiliation_id, user_id, status, created_at, updated_at)
				 SELECT ?1, ?2, ?3, 'pending', ?4, ?4
				 WHERE EXISTS (SELECT 1 FROM affiliations WHERE id = ?2)
				   AND EXISTS (SELECT 1 FROM users WHERE id = ?3 AND status = 'active')`,
			).bind(id, affiliationId, actor.id, now),
			env.DB.prepare(
				`INSERT INTO audit_log
				 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
				 SELECT ?1, ?2, 'affiliation.request_submitted', 'affiliation_request', ?3, ?4, ?5
				 WHERE EXISTS (SELECT 1 FROM affiliation_membership_requests WHERE id = ?3 AND status = 'pending')`,
			).bind(crypto.randomUUID(), actor.id, id, JSON.stringify({ affiliationId }), now),
		]);
		if (results[0]?.meta.changes !== 1) throw new AffiliationRequestMutationError("member-unavailable");
	} catch (error) {
		if (error instanceof AffiliationRequestMutationError) throw error;
		if (error instanceof Error && error.message.includes("UNIQUE")) throw new AffiliationRequestMutationError("already-pending");
		throw error;
	}
	return { id };
}

export async function cancelAffiliationRequest(env: Env, actor: AuthenticatedUser, requestId: string) {
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE affiliation_membership_requests
			 SET status = 'cancelled', updated_at = ?1
			 WHERE id = ?2 AND user_id = ?3 AND status = 'pending'`,
		).bind(now, requestId, actor.id),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'affiliation.request_cancelled', 'affiliation_request', ?3, NULL, ?4
			 WHERE changes() = 1`,
		).bind(crypto.randomUUID(), actor.id, requestId, now),
	]);
	if (results[0]?.meta.changes !== 1) throw new AffiliationRequestMutationError("request-unavailable");
}

export async function listPendingAffiliationRequests(env: Env) {
	const result = await env.DB.prepare(
		`${requestSelection}
		 WHERE request.status = 'pending'
		 ORDER BY request.created_at ASC, request.id ASC`,
	).all<AffiliationMembershipRequest>();
	return result.results;
}

export async function reviewAffiliationRequest(
	env: Env,
	actor: AuthenticatedUser,
	input: { requestId: string; decision: "approve" | "reject"; reason: string | null },
) {
	if (actor.siteRole !== "site_admin") throw new AffiliationRequestMutationError("forbidden");
	const request = await env.DB.prepare(`${requestSelection} WHERE request.id = ?1 LIMIT 1`)
		.bind(input.requestId).first<AffiliationMembershipRequest>();
	if (!request) throw new AffiliationRequestMutationError("request-unavailable");
	if (request.status !== "pending") throw new AffiliationRequestMutationError("already-reviewed");
	if (request.userId === actor.id) throw new AffiliationRequestMutationError("self-review");
	if (input.decision === "reject" && (!input.reason || input.reason.trim().length < 3)) throw new AffiliationRequestMutationError("request-unavailable");
	if (input.decision === "approve") {
		const available = await env.DB.prepare(
			`SELECT 1 FROM users AS u, affiliations AS a
			 WHERE u.id = ?1 AND u.status = 'active' AND a.id = ?2`,
		).bind(request.userId, request.affiliationId).first<number>("1");
		if (available === null) throw new AffiliationRequestMutationError("member-unavailable");
	}

	const now = new Date().toISOString();
	const nextStatus = input.decision === "approve" ? "approved" : "rejected";
	const notificationBody = input.decision === "approve"
		? `Your request to join ${request.affiliationName} was approved.`
		: `Your request to join ${request.affiliationName} was not approved.${input.reason ? ` ${input.reason}` : ""}`;
	const results = await env.DB.batch([
		...(input.decision === "approve" ? [env.DB.prepare(
			`INSERT INTO user_affiliations (user_id, affiliation_id, created_at)
			 SELECT user_id, affiliation_id, ?1 FROM affiliation_membership_requests
			 WHERE id = ?2 AND status = 'pending'
			 ON CONFLICT(user_id, affiliation_id) DO NOTHING`,
		).bind(now, request.id)] : []),
		env.DB.prepare(
			`UPDATE affiliation_membership_requests
			 SET status = ?1, reviewed_by_user_id = ?2, reviewed_at = ?3,
			     review_reason = ?4, updated_at = ?3
			 WHERE id = ?5 AND status = 'pending'`,
		).bind(nextStatus, actor.id, now, input.reason, request.id),
		env.DB.prepare(
			`INSERT INTO notifications
			 (id, user_id, actor_user_id, post_id, comment_id, type, body, read_at, created_at)
			 SELECT ?1, user_id, ?2, NULL, NULL, 'approval', ?3, NULL, ?4
			 FROM affiliation_membership_requests
			 WHERE id = ?5 AND status = ?6 AND reviewed_by_user_id = ?2 AND reviewed_at = ?4`,
		).bind(crypto.randomUUID(), actor.id, notificationBody, now, request.id, nextStatus),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, ?3, 'affiliation_request', ?4, ?5, ?6
			 WHERE EXISTS (
			   SELECT 1 FROM affiliation_membership_requests
			   WHERE id = ?4 AND status = ?7 AND reviewed_by_user_id = ?2 AND reviewed_at = ?6
			 )`,
		).bind(crypto.randomUUID(), actor.id, `affiliation.request_${nextStatus}`, request.id, JSON.stringify({ affiliationId: request.affiliationId, userId: request.userId, reason: input.reason }), now, nextStatus),
	]);
	const reviewResultIndex = input.decision === "approve" ? 1 : 0;
	if (results[reviewResultIndex]?.meta.changes !== 1) throw new AffiliationRequestMutationError("already-reviewed");
	return nextStatus;
}
