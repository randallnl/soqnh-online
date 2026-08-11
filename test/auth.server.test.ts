import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sanitizeReturnTo } from "../app/lib/auth";
import {
	consumeLoginToken,
	createRandomSecret,
	createUserSession,
	getAuthenticatedUser,
	hashSecret,
	issueLoginToken,
	normalizeEmail,
	revokeUserSession,
} from "../app/lib/auth.server";

declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}

const activeUser = {
	id: "user-active",
	email: "member@example.org",
	name: "Test Member",
	siteRole: "member" as const,
	status: "active" as const,
};

async function seedUser(status: "active" | "invited" | "suspended" = "active") {
	await env.DB.prepare(
		`INSERT INTO users
		 (id, email, name, site_role, status, created_at, updated_at, profile_visibility)
		 VALUES (?1, ?2, ?3, 'member', ?4, ?5, ?5, 'members')`,
	)
		.bind(
			activeUser.id,
			activeUser.email,
			activeUser.name,
			status,
			new Date().toISOString(),
		)
		.run();
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM audit_log"),
		env.DB.prepare("DELETE FROM sessions"),
		env.DB.prepare("DELETE FROM auth_tokens"),
		env.DB.prepare("DELETE FROM users"),
	]);
});

describe("authentication primitives", () => {
	it("creates random secrets and stable SHA-256 hashes", async () => {
		const first = createRandomSecret();
		const second = createRandomSecret();

		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(second).toMatch(/^[a-f0-9]{64}$/);
		expect(first).not.toBe(second);
		expect(await hashSecret(first)).toBe(await hashSecret(first));
		expect(await hashSecret(first)).not.toBe(first);
	});

	it("normalizes email addresses and rejects external return URLs", () => {
		expect(normalizeEmail("  Member@Example.ORG ")).toBe("member@example.org");
		expect(sanitizeReturnTo("/events?view=month")).toBe(
			"/events?view=month",
		);
		expect(sanitizeReturnTo("https://attacker.example/path")).toBe("/");
		expect(sanitizeReturnTo("//attacker.example/path")).toBe("/");
	});
});

describe("magic-link tokens", () => {
	it("stores only the hash and consumes a token once", async () => {
		await seedUser();
		const issued = await issueLoginToken(env, "Member@Example.org");
		expect(issued).not.toBeNull();
		if (!issued) throw new Error("Expected a login token");

		const stored = await env.DB.prepare(
			"SELECT token_hash AS tokenHash FROM auth_tokens WHERE email = ?1",
		)
			.bind(activeUser.email)
			.first<{ tokenHash: string }>();
		expect(stored?.tokenHash).toBe(await hashSecret(issued.token));
		expect(stored?.tokenHash).not.toContain(issued.token);

		await expect(consumeLoginToken(env, issued.token)).resolves.toEqual(
			activeUser,
		);
		await expect(consumeLoginToken(env, issued.token)).resolves.toBeNull();
	});

	it("rate-limits duplicate requests without issuing another token", async () => {
		await seedUser();
		expect(await issueLoginToken(env, activeUser.email)).not.toBeNull();
		expect(await issueLoginToken(env, activeUser.email)).toBeNull();

		const count = await env.DB.prepare(
			"SELECT count(*) AS count FROM auth_tokens",
		).first<number>("count");
		expect(count).toBe(1);
	});

	it("does not issue tokens for unknown or inactive accounts", async () => {
		expect(await issueLoginToken(env, "unknown@example.org")).toBeNull();
		await seedUser("suspended");
		expect(await issueLoginToken(env, activeUser.email)).toBeNull();
	});
});

describe("database-backed sessions", () => {
	it("authenticates an active user and revokes the session on logout", async () => {
		await seedUser();
		const cookie = await createUserSession(env, activeUser);
		const request = new Request("https://soqnh.example/", {
			headers: { Cookie: cookie.split(";", 1)[0] ?? "" },
		});

		await expect(getAuthenticatedUser(request, env)).resolves.toEqual(
			activeUser,
		);
		const clearedCookie = await revokeUserSession(request, env);
		expect(clearedCookie).toContain("Max-Age=0");
		await expect(getAuthenticatedUser(request, env)).resolves.toBeNull();
	});

	it("blocks an existing session after the account is suspended", async () => {
		await seedUser();
		const cookie = await createUserSession(env, activeUser);
		await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?1")
			.bind(activeUser.id)
			.run();
		const request = new Request("https://soqnh.example/", {
			headers: { Cookie: cookie.split(";", 1)[0] ?? "" },
		});

		await expect(getAuthenticatedUser(request, env)).resolves.toBeNull();
	});
});
