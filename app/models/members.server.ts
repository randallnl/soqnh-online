import type { AuthenticatedUser } from "../lib/auth.server";

export type MemberStatus = "invited" | "active" | "suspended";

export type ManagedMember = {
	id: string;
	email: string;
	name: string | null;
	siteRole: "member" | "site_admin";
	status: MemberStatus;
	createdAt: string;
	lastSeenAt: string | null;
	organizations: string | null;
};

export type MemberAccessAuditEvent = {
	id: string;
	action: "member.suspended" | "member.restored";
	targetName: string | null;
	targetEmail: string;
	actorName: string | null;
	actorEmail: string;
	createdAt: string;
};

type TargetMemberRow = Pick<ManagedMember, "id" | "siteRole" | "status">;

export class MemberStatusError extends Error {
	constructor(
		public readonly reason:
			| "not-found"
			| "invalid-transition"
			| "self-suspension"
			| "last-site-admin",
	) {
		super(reason);
		this.name = "MemberStatusError";
	}
}

export async function listManagedMembers(env: Env) {
	const result = await env.DB.prepare(
		`SELECT u.id,
		        u.email,
		        u.name,
		        u.site_role AS siteRole,
		        u.status,
		        u.created_at AS createdAt,
		        u.last_seen_at AS lastSeenAt,
		        (
		          SELECT group_concat(o.name || ' · ' || om.role, ', ')
		          FROM organization_memberships AS om
		          JOIN organizations AS o ON o.id = om.organization_id
		          WHERE om.user_id = u.id
		        ) AS organizations
		 FROM users AS u
		 ORDER BY
		   CASE u.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END,
		   coalesce(u.name, u.email) COLLATE NOCASE`,
	).all<ManagedMember>();

	return result.results;
}

export async function getMemberStatusCounts(env: Env) {
	const row = await env.DB.prepare(
		`SELECT count(*) AS total,
		        coalesce(sum(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
		        coalesce(sum(CASE WHEN status = 'invited' THEN 1 ELSE 0 END), 0) AS invited,
		        coalesce(sum(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended,
		        coalesce(sum(CASE WHEN status = 'active' AND site_role = 'site_admin' THEN 1 ELSE 0 END), 0) AS activeSiteAdmins
		 FROM users`,
	).first<{
		total: number;
		active: number;
		invited: number;
		suspended: number;
		activeSiteAdmins: number;
	}>();

	return (
		row ?? {
			total: 0,
			active: 0,
			invited: 0,
			suspended: 0,
			activeSiteAdmins: 0,
		}
	);
}

export async function listMemberAccessAudit(env: Env) {
	const result = await env.DB.prepare(
		`SELECT a.id,
		        a.action,
		        target.name AS targetName,
		        target.email AS targetEmail,
		        actor.name AS actorName,
		        actor.email AS actorEmail,
		        a.created_at AS createdAt
		 FROM audit_log AS a
		 JOIN users AS target ON target.id = a.entity_id
		 JOIN users AS actor ON actor.id = a.actor_user_id
		 WHERE a.entity_type = 'user'
		   AND a.action IN ('member.suspended', 'member.restored')
		 ORDER BY a.created_at DESC
		 LIMIT 20`,
	).all<MemberAccessAuditEvent>();

	return result.results;
}

export async function changeMemberStatus(
	env: Env,
	actor: AuthenticatedUser,
	input: { targetUserId: string; nextStatus: "active" | "suspended" },
) {
	const session = env.DB.withSession("first-primary");
	const target = await session
		.prepare(
			`SELECT id, site_role AS siteRole, status
			 FROM users
			 WHERE id = ?1
			 LIMIT 1`,
		)
		.bind(input.targetUserId)
		.first<TargetMemberRow>();

	if (!target) throw new MemberStatusError("not-found");
	if (input.nextStatus === "suspended" && target.id === actor.id) {
		throw new MemberStatusError("self-suspension");
	}

	const previousStatus = input.nextStatus === "suspended" ? "active" : "suspended";
	if (target.status !== previousStatus) {
		throw new MemberStatusError("invalid-transition");
	}

	if (input.nextStatus === "suspended" && target.siteRole === "site_admin") {
		const activeAdminCount = await session
			.prepare(
				`SELECT count(*) AS count
				 FROM users
				 WHERE site_role = 'site_admin' AND status = 'active'`,
			)
			.first<number>("count");
		if ((activeAdminCount ?? 0) <= 1) {
			throw new MemberStatusError("last-site-admin");
		}
	}

	const now = new Date().toISOString();
	const action =
		input.nextStatus === "suspended"
			? ("member.suspended" as const)
			: ("member.restored" as const);
	const statements = [
		session.prepare(
			`UPDATE users
			 SET status = ?1, updated_at = ?2
			 WHERE id = ?3
			   AND status = ?4
			   AND (?1 != 'suspended' OR id != ?5)
			   AND (
			     ?1 != 'suspended'
			     OR site_role != 'site_admin'
			     OR (SELECT count(*) FROM users WHERE site_role = 'site_admin' AND status = 'active') > 1
			   )`,
		).bind(
			input.nextStatus,
			now,
			target.id,
			previousStatus,
			actor.id,
		),
	];

	if (input.nextStatus === "suspended") {
		statements.push(
			session.prepare(
				`UPDATE sessions
				 SET revoked_at = ?1
				 WHERE user_id = ?2
				   AND revoked_at IS NULL
				   AND EXISTS (
				     SELECT 1 FROM users
				     WHERE id = ?2 AND status = 'suspended' AND updated_at = ?1
				   )`,
			).bind(now, target.id),
		);
	}

	statements.push(
		session.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, ?3, 'user', ?4, ?5, ?6
			 FROM users
			 WHERE id = ?4 AND status = ?7 AND updated_at = ?6`,
		).bind(
			crypto.randomUUID(),
			actor.id,
			action,
			target.id,
			JSON.stringify({ previousStatus, nextStatus: input.nextStatus }),
			now,
			input.nextStatus,
		),
	);

	const results = await session.batch(statements);
	if (results[0]?.meta.changes !== 1) {
		if (target.id === actor.id) throw new MemberStatusError("self-suspension");
		if (target.siteRole === "site_admin") {
			throw new MemberStatusError("last-site-admin");
		}
		throw new MemberStatusError("invalid-transition");
	}

	return { targetUserId: target.id, previousStatus, nextStatus: input.nextStatus };
}
