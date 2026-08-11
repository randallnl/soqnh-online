import { sanitizeReturnTo } from "./auth";

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
const LOGIN_REQUEST_COOLDOWN_MS = 2 * 60 * 1000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PRODUCTION_COOKIE_NAME = "__Host-soqnh_session";
const DEVELOPMENT_COOKIE_NAME = "soqnh_session";

export type AuthenticatedUser = {
	id: string;
	email: string;
	name: string | null;
	siteRole: "member" | "site_admin";
	status: "active";
};

type UserRow = Omit<AuthenticatedUser, "status"> & {
	status: "invited" | "active" | "suspended";
};

type LoginTokenRow = {
	email: string;
};

function bytesToHex(bytes: Uint8Array) {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createRandomSecret() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

export async function hashSecret(secret: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(secret),
	);
	return bytesToHex(new Uint8Array(digest));
}

export function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

function getCookieName(env: Env) {
	return env.APP_ENV === "production"
		? PRODUCTION_COOKIE_NAME
		: DEVELOPMENT_COOKIE_NAME;
}

function parseCookie(header: string | null, name: string) {
	if (!header) return null;

	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== name) continue;
		return part.slice(separator + 1).trim() || null;
	}

	return null;
}

function serializeSessionCookie(env: Env, value: string, maxAge: number) {
	const attributes = [
		`${getCookieName(env)}=${value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAge}`,
	];
	if (env.APP_ENV === "production") attributes.push("Secure");
	return attributes.join("; ");
}

async function findUserByEmail(env: Env, email: string) {
	return env.DB.prepare(
		`SELECT id, email, name, site_role AS siteRole, status
		 FROM users
		 WHERE lower(email) = ?1
		 LIMIT 1`,
	)
		.bind(email)
		.first<UserRow>();
}

async function writeAuditEvent(
	env: Env,
	event: {
		actorUserId: string | null;
		action: string;
		entityType: string;
		entityId: string;
		metadata?: Record<string, unknown>;
	},
) {
	await env.DB.prepare(
		`INSERT INTO audit_log
		 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
	)
		.bind(
			crypto.randomUUID(),
			event.actorUserId,
			event.action,
			event.entityType,
			event.entityId,
			event.metadata ? JSON.stringify(event.metadata) : null,
			new Date().toISOString(),
		)
		.run();
}

export async function issueLoginToken(env: Env, emailInput: string) {
	const email = normalizeEmail(emailInput);
	const user = await findUserByEmail(env, email);

	// Keep this response indistinguishable for unknown, invited, and suspended users.
	if (!user || user.status !== "active") return null;

	const cooldownStart = new Date(
		Date.now() - LOGIN_REQUEST_COOLDOWN_MS,
	).toISOString();
	const recentlyIssued = await env.DB.prepare(
		`SELECT 1
		 FROM auth_tokens
		 WHERE email = ?1
		   AND purpose = 'login'
		   AND consumed_at IS NULL
		   AND created_at >= ?2
		 LIMIT 1`,
	)
		.bind(email, cooldownStart)
		.first<number>("1");
	if (recentlyIssued !== null) return null;

	const token = createRandomSecret();
	const tokenHash = await hashSecret(token);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + LOGIN_TOKEN_TTL_MS);

	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO auth_tokens
			 (id, email, token_hash, purpose, expires_at, consumed_at, created_at)
			 VALUES (?1, ?2, ?3, 'login', ?4, NULL, ?5)`,
		).bind(
			crypto.randomUUID(),
			email,
			tokenHash,
			expiresAt.toISOString(),
			now.toISOString(),
		),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'auth.magic_link_requested', 'user', ?2, ?3, ?4)`,
		).bind(
			crypto.randomUUID(),
			user.id,
			JSON.stringify({ expiresAt: expiresAt.toISOString() }),
			now.toISOString(),
		),
	]);

	return { token, tokenHash, user, expiresAt };
}

export async function invalidateLoginToken(env: Env, tokenHash: string) {
	await env.DB.prepare(
		`UPDATE auth_tokens
		 SET consumed_at = ?1
		 WHERE token_hash = ?2 AND consumed_at IS NULL`,
	)
		.bind(new Date().toISOString(), tokenHash)
		.run();
}

export async function consumeLoginToken(env: Env, token: string) {
	if (!/^[a-f0-9]{64}$/i.test(token)) return null;

	const now = new Date().toISOString();
	const tokenHash = await hashSecret(token);
	const consumed = await env.DB.prepare(
		`UPDATE auth_tokens
		 SET consumed_at = ?1
		 WHERE token_hash = ?2
		   AND purpose = 'login'
		   AND consumed_at IS NULL
		   AND expires_at > ?1
		 RETURNING email`,
	)
		.bind(now, tokenHash)
		.first<LoginTokenRow>();
	if (!consumed) return null;

	const user = await findUserByEmail(env, normalizeEmail(consumed.email));
	if (!user || user.status !== "active") return null;

	return user as AuthenticatedUser;
}

export async function createUserSession(env: Env, user: AuthenticatedUser) {
	const sessionSecret = createRandomSecret();
	const sessionHash = await hashSecret(sessionSecret);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

	await env.DB.batch([
		env.DB.prepare(
			`DELETE FROM sessions
			 WHERE user_id = ?1
			   AND (expires_at <= ?2 OR revoked_at IS NOT NULL)`,
		).bind(user.id, now.toISOString()),
		env.DB.prepare(
			`INSERT INTO sessions (id, user_id, expires_at, created_at, revoked_at)
			 VALUES (?1, ?2, ?3, ?4, NULL)`,
		).bind(sessionHash, user.id, expiresAt.toISOString(), now.toISOString()),
		env.DB.prepare(
			`UPDATE users SET last_seen_at = ?1, updated_at = ?1 WHERE id = ?2`,
		).bind(now.toISOString(), user.id),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'auth.login_succeeded', 'session', ?3, NULL, ?4)`,
		).bind(crypto.randomUUID(), user.id, sessionHash, now.toISOString()),
	]);

	return serializeSessionCookie(env, sessionSecret, SESSION_TTL_SECONDS);
}

export async function getAuthenticatedUser(request: Request, env: Env) {
	const secret = parseCookie(
		request.headers.get("Cookie"),
		getCookieName(env),
	);
	if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) return null;

	const sessionHash = await hashSecret(secret);
	return env.DB.prepare(
		`SELECT u.id, u.email, u.name, u.site_role AS siteRole, u.status
		 FROM sessions AS s
		 JOIN users AS u ON u.id = s.user_id
		 WHERE s.id = ?1
		   AND s.revoked_at IS NULL
		   AND s.expires_at > ?2
		   AND u.status = 'active'
		 LIMIT 1`,
	)
		.bind(sessionHash, new Date().toISOString())
		.first<AuthenticatedUser>();
}

export async function requireAuthenticatedUser(request: Request, env: Env) {
	const user = await getAuthenticatedUser(request, env);
	if (user) return user;

	const requestUrl = new URL(request.url);
	const returnTo = sanitizeReturnTo(`${requestUrl.pathname}${requestUrl.search}`);
	throw new Response(null, {
		status: 302,
		headers: {
			Location: `/login?returnTo=${encodeURIComponent(returnTo)}`,
		},
	});
}

export async function requireSiteAdmin(request: Request, env: Env) {
	const user = await requireAuthenticatedUser(request, env);
	if (user.siteRole !== "site_admin") {
		throw new Response("Forbidden", { status: 403 });
	}
	return user;
}

export async function revokeUserSession(request: Request, env: Env) {
	const secret = parseCookie(
		request.headers.get("Cookie"),
		getCookieName(env),
	);
	if (secret && /^[a-f0-9]{64}$/i.test(secret)) {
		const sessionHash = await hashSecret(secret);
		const session = await env.DB.prepare(
			`SELECT user_id AS userId
			 FROM sessions
			 WHERE id = ?1 AND revoked_at IS NULL
			 LIMIT 1`,
		)
			.bind(sessionHash)
			.first<{ userId: string }>();

		if (session) {
			const now = new Date().toISOString();
			await env.DB.batch([
				env.DB.prepare(
					`UPDATE sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL`,
				).bind(now, sessionHash),
				env.DB.prepare(
					`INSERT INTO audit_log
					 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
					 VALUES (?1, ?2, 'auth.logout', 'session', ?3, NULL, ?4)`,
				).bind(crypto.randomUUID(), session.userId, sessionHash, now),
			]);
		}
	}

	return serializeSessionCookie(env, "", 0);
}

export async function auditAuthenticationFailure(
	env: Env,
	userId: string,
	action: string,
	metadata?: Record<string, unknown>,
) {
	await writeAuditEvent(env, {
		actorUserId: userId,
		action,
		entityType: "user",
		entityId: userId,
		metadata,
	});
}
