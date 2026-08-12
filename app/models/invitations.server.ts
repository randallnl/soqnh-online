import {
	type AuthenticatedUser,
	createRandomSecret,
	hashSecret,
	normalizeEmail,
} from "../lib/auth.server";
import type { OrganizationRole } from "../lib/invitations";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ExistingUserRow = {
	id: string;
	status: "invited" | "active" | "suspended";
};

type InvitationRow = {
	id: string;
	email: string;
	organizationId: string | null;
	organizationName: string | null;
	invitedRole: OrganizationRole;
	expiresAt: string;
	acceptedAt: string | null;
	createdAt: string;
};

export type InvitationDetails = InvitationRow & {
	status: "pending" | "accepted" | "expired";
};

export class InvitationConflictError extends Error {
	constructor(
		public readonly reason: "active" | "suspended" | "organization-unavailable",
	) {
		super(reason);
		this.name = "InvitationConflictError";
	}
}

function invitationStatus(row: InvitationRow): InvitationDetails["status"] {
	if (row.acceptedAt) return "accepted";
	if (row.expiresAt <= new Date().toISOString()) return "expired";
	return "pending";
}

export async function listActiveOrganizations(env: Env) {
	const result = await env.DB.prepare(
		`SELECT id, name
		 FROM organizations
		 WHERE status = 'active'
		 ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	return result.results;
}

export async function listRecentInvitations(env: Env) {
	const result = await env.DB.prepare(
		`SELECT i.id,
		        i.email,
		        i.organization_id AS organizationId,
		        o.name AS organizationName,
		        i.invited_role AS invitedRole,
		        i.expires_at AS expiresAt,
		        i.accepted_at AS acceptedAt,
		        i.created_at AS createdAt
		 FROM invitations AS i
		 LEFT JOIN organizations AS o ON o.id = i.organization_id
		 ORDER BY i.created_at DESC
		 LIMIT 25`,
	).all<InvitationRow>();

	return result.results.map((row) => ({
		...row,
		status: invitationStatus(row),
	}));
}

export async function createInvitation(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		email: string;
		organizationId: string | null;
		invitedRole: OrganizationRole;
	},
) {
	const email = normalizeEmail(input.email);
	const existingUser = await env.DB.prepare(
		`SELECT id, status
		 FROM users
		 WHERE lower(email) = ?1
		 LIMIT 1`,
	)
		.bind(email)
		.first<ExistingUserRow>();

	if (existingUser?.status === "active") {
		throw new InvitationConflictError("active");
	}
	if (existingUser?.status === "suspended") {
		throw new InvitationConflictError("suspended");
	}

	if (input.organizationId) {
		const organizationIsActive = await env.DB.prepare(
			`SELECT 1
			 FROM organizations
			 WHERE id = ?1 AND status = 'active'
			 LIMIT 1`,
		)
			.bind(input.organizationId)
			.first<number>("1");
		if (organizationIsActive === null) {
			throw new InvitationConflictError("organization-unavailable");
		}
	}

	const token = createRandomSecret();
	const tokenHash = await hashSecret(token);
	const invitationId = crypto.randomUUID();
	const userId = existingUser?.id ?? crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
	const nowIso = now.toISOString();

	const results = await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO users
			 (id, email, site_role, status, created_at, updated_at, profile_visibility)
			 VALUES (?1, ?2, 'member', 'invited', ?3, ?3, 'members')
			 ON CONFLICT(email) DO NOTHING`,
		).bind(userId, email, nowIso),
		env.DB.prepare(
			`UPDATE invitations
			 SET expires_at = ?1
			 WHERE lower(email) = ?2
			   AND accepted_at IS NULL
			   AND expires_at > ?1`,
		).bind(nowIso, email),
		env.DB.prepare(
			`INSERT INTO invitations
			 (id, email, organization_id, invited_role, token_hash,
			  invited_by_user_id, expires_at, accepted_at, created_at)
			 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8
			 WHERE EXISTS (
			   SELECT 1 FROM users WHERE lower(email) = ?2 AND status = 'invited'
			 )`,
		).bind(
			invitationId,
			email,
			input.organizationId,
			input.invitedRole,
			tokenHash,
			actor.id,
			expiresAt.toISOString(),
			nowIso,
		),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'invitation.created', 'invitation', i.id, ?3, ?4
			 FROM invitations AS i
			 WHERE i.id = ?5`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			JSON.stringify({
				email,
				organizationId: input.organizationId,
				invitedRole: input.invitedRole,
				expiresAt: expiresAt.toISOString(),
			}),
			nowIso,
			invitationId,
		),
	]);

	if (results[2]?.meta.changes !== 1) {
		throw new InvitationConflictError("active");
	}

	return {
		id: invitationId,
		email,
		token,
		tokenHash,
		expiresAt,
	};
}

export async function invalidateInvitation(env: Env, invitationId: string) {
	await env.DB.prepare(
		`UPDATE invitations
		 SET expires_at = ?1
		 WHERE id = ?2 AND accepted_at IS NULL`,
	)
		.bind(new Date().toISOString(), invitationId)
		.run();
}

export async function auditInvitationDeliveryFailure(
	env: Env,
	input: { invitationId: string; actorUserId: string },
) {
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO audit_log
		 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
		 VALUES (?1, ?2, 'invitation.delivery_failed', 'invitation', ?3, NULL, ?4)`,
	)
		.bind(crypto.randomUUID(), input.actorUserId, input.invitationId, now)
		.run();
}

export async function getInvitationByToken(env: Env, token: string) {
	if (!/^[a-f0-9]{64}$/i.test(token)) return null;
	const tokenHash = await hashSecret(token);
	const row = await env.DB.prepare(
		`SELECT i.id,
		        i.email,
		        i.organization_id AS organizationId,
		        o.name AS organizationName,
		        i.invited_role AS invitedRole,
		        i.expires_at AS expiresAt,
		        i.accepted_at AS acceptedAt,
		        i.created_at AS createdAt
		 FROM invitations AS i
		 LEFT JOIN organizations AS o ON o.id = i.organization_id
		 JOIN users AS u ON lower(u.email) = lower(i.email)
		 WHERE i.token_hash = ?1
		   AND i.accepted_at IS NULL
		   AND i.expires_at > ?2
		   AND u.status = 'invited'
		 LIMIT 1`,
	)
		.bind(tokenHash, new Date().toISOString())
		.first<InvitationRow>();

	return row ? { ...row, status: invitationStatus(row) } : null;
}

export async function acceptInvitation(
	env: Env,
	input: { token: string; name: string },
) {
	if (!/^[a-f0-9]{64}$/i.test(input.token)) return null;
	const tokenHash = await hashSecret(input.token);
	const now = new Date().toISOString();
	const session = env.DB.withSession("first-primary");
	const invitation = await session
		.prepare(
			`SELECT i.id, i.email
			 FROM invitations AS i
			 JOIN users AS u ON lower(u.email) = lower(i.email)
			 WHERE i.token_hash = ?1
			   AND i.accepted_at IS NULL
			   AND i.expires_at > ?2
			   AND u.status = 'invited'
			 LIMIT 1`,
		)
		.bind(tokenHash, now)
		.first<{ id: string; email: string }>();
	if (!invitation) return null;

	const results = await session.batch([
		session.prepare(
			`UPDATE invitations
			 SET accepted_at = ?1
			 WHERE token_hash = ?2
			   AND accepted_at IS NULL
			   AND expires_at > ?1
			   AND EXISTS (
			     SELECT 1 FROM users
			     WHERE lower(email) = lower(invitations.email)
			       AND status = 'invited'
			   )`,
		).bind(now, tokenHash),
		session.prepare(
			`UPDATE users
			 SET name = ?1, status = 'active', updated_at = ?2
			 WHERE lower(email) = lower(?3)
			   AND status = 'invited'
			   AND EXISTS (
			     SELECT 1 FROM invitations
			     WHERE token_hash = ?4 AND accepted_at = ?2
			   )`,
		).bind(input.name.trim(), now, invitation.email, tokenHash),
		session.prepare(
			`INSERT INTO organization_memberships
			 (organization_id, user_id, role, created_at)
			 SELECT i.organization_id, u.id, i.invited_role, ?1
			 FROM invitations AS i
			 JOIN users AS u ON lower(u.email) = lower(i.email)
			 WHERE i.token_hash = ?2
			   AND i.accepted_at = ?1
			   AND i.organization_id IS NOT NULL
			 ON CONFLICT(organization_id, user_id)
			 DO UPDATE SET role = excluded.role`,
		).bind(now, tokenHash),
		session.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, u.id, 'invitation.accepted', 'invitation', i.id,
			        json_object('organizationId', i.organization_id, 'role', i.invited_role), ?2
			 FROM invitations AS i
			 JOIN users AS u ON lower(u.email) = lower(i.email)
			 WHERE i.token_hash = ?3 AND i.accepted_at = ?2`,
		).bind(crypto.randomUUID(), now, tokenHash),
	]);

	if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
		return null;
	}

	return session
		.prepare(
			`SELECT id, email, name, site_role AS siteRole, status
			 FROM users
			 WHERE lower(email) = lower(?1) AND status = 'active'
			 LIMIT 1`,
		)
		.bind(invitation.email)
		.first<AuthenticatedUser>();
}
