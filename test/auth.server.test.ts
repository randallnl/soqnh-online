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
import {
	acceptInvitation,
	createInvitation,
	getInvitationByToken,
} from "../app/models/invitations.server";
import {
	changeMemberStatus,
	listManagedMembers,
	listMemberAccessAudit,
} from "../app/models/members.server";
import { slugifyOrganizationName } from "../app/lib/organizations";
import { slugifyAffiliationName } from "../app/lib/affiliations";
import {
	addOrganizationAffiliation,
	addUserAffiliation,
	createAffiliation,
	getAffiliationAdministrationData,
	removeOrganizationAffiliation,
	removeUserAffiliation,
	updateAffiliation,
} from "../app/models/affiliations.server";
import {
	createOrganization,
	getOrganizationAdministrationData,
	getOrganizationBySlug,
	getOrganizationManagementData,
	listManagedOrganizations,
	listVisibleOrganizations,
	removeOrganizationMembership,
	setOrganizationMembership,
	updateOrganization,
	updateManagedOrganizationProfile,
} from "../app/models/organizations.server";

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

const siteAdmin = {
	id: "user-admin",
	email: "admin@example.org",
	name: "Site Admin",
	siteRole: "site_admin" as const,
	status: "active" as const,
};

const secondMember = {
	id: "user-second",
	email: "second@example.org",
	name: "Second Member",
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

async function seedSiteAdmin() {
	await env.DB.prepare(
		`INSERT INTO users
		 (id, email, name, site_role, status, created_at, updated_at, profile_visibility)
		 VALUES (?1, ?2, ?3, 'site_admin', 'active', ?4, ?4, 'members')`,
	)
		.bind(
			siteAdmin.id,
			siteAdmin.email,
			siteAdmin.name,
			new Date().toISOString(),
		)
		.run();
}

async function seedSecondMember(profileVisibility: "members" | "hidden" = "members") {
	await env.DB.prepare(
		`INSERT INTO users
		 (id, email, name, site_role, status, created_at, updated_at, profile_visibility)
		 VALUES (?1, ?2, ?3, 'member', 'active', ?4, ?4, ?5)`,
	)
		.bind(
			secondMember.id,
			secondMember.email,
			secondMember.name,
			new Date().toISOString(),
			profileVisibility,
		)
		.run();
}

async function seedAdditionalSiteAdmin() {
	await env.DB.prepare(
		`INSERT INTO users
		 (id, email, name, site_role, status, created_at, updated_at, profile_visibility)
		 VALUES ('user-admin-two', 'admin-two@example.org', 'Second Admin', 'site_admin', 'active', ?1, ?1, 'members')`,
	)
		.bind(new Date().toISOString())
		.run();
}

async function seedOrganization() {
	await env.DB.prepare(
		`INSERT INTO organizations
		 (id, name, slug, status, created_at, updated_at, event_scraping_enabled)
		 VALUES ('org-one', 'Community Center', 'community-center', 'active', ?1, ?1, 0)`,
	)
		.bind(new Date().toISOString())
		.run();
}

async function seedSecondOrganization() {
	await env.DB.prepare(
		`INSERT INTO organizations
		 (id, name, slug, status, created_at, updated_at, event_scraping_enabled)
		 VALUES ('org-two', 'Shared Network Org', 'shared-network-org', 'active', ?1, ?1, 0)`,
	)
		.bind(new Date().toISOString())
		.run();
}

async function seedAffiliation(
	id = "aff-shared",
	name = "Shared Coalition",
	slug = "shared-coalition",
) {
	await env.DB.prepare(
		`INSERT INTO affiliations (id, name, slug, created_at)
		 VALUES (?1, ?2, ?3, ?4)`,
	)
		.bind(id, name, slug, new Date().toISOString())
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
		env.DB.prepare("DELETE FROM organization_affiliations"),
		env.DB.prepare("DELETE FROM user_affiliations"),
		env.DB.prepare("DELETE FROM organization_memberships"),
		env.DB.prepare("DELETE FROM invitations"),
		env.DB.prepare("DELETE FROM users"),
		env.DB.prepare("DELETE FROM organizations"),
		env.DB.prepare("DELETE FROM affiliations"),
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

	it("creates stable organization slugs", () => {
		expect(slugifyOrganizationName("  Seacoast Pride & Community  ")).toBe(
			"seacoast-pride-community",
		);
	});

	it("creates stable affiliation slugs", () => {
		expect(slugifyAffiliationName("  NH Queer Consortium  ")).toBe(
			"nh-queer-consortium",
		);
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

describe("member invitations", () => {
	it("stores only the invitation hash and creates an invited account", async () => {
		await seedSiteAdmin();
		const invitation = await createInvitation(env, siteAdmin, {
			email: " New.Member@Example.org ",
			organizationId: null,
			invitedRole: "viewer",
		});

		const stored = await env.DB.prepare(
			`SELECT i.email, i.token_hash AS tokenHash, u.status
			 FROM invitations AS i
			 JOIN users AS u ON u.email = i.email
			 WHERE i.id = ?1`,
		)
			.bind(invitation.id)
			.first<{ email: string; tokenHash: string; status: string }>();

		expect(stored).toEqual({
			email: "new.member@example.org",
			tokenHash: await hashSecret(invitation.token),
			status: "invited",
		});
		expect(stored?.tokenHash).not.toContain(invitation.token);
		await expect(getInvitationByToken(env, invitation.token)).resolves.toMatchObject({
			id: invitation.id,
			email: "new.member@example.org",
			status: "pending",
		});
	});

	it("activates the account, assigns its organization role, and consumes once", async () => {
		await seedSiteAdmin();
		await seedOrganization();
		const invitation = await createInvitation(env, siteAdmin, {
			email: "new.member@example.org",
			organizationId: "org-one",
			invitedRole: "contributor",
		});

		const accepted = await acceptInvitation(env, {
			token: invitation.token,
			name: "  New Member  ",
		});

		expect(accepted).toMatchObject({
			email: "new.member@example.org",
			name: "New Member",
			siteRole: "member",
			status: "active",
		});
		await expect(
			acceptInvitation(env, {
				token: invitation.token,
				name: "New Member",
			}),
		).resolves.toBeNull();

		const membership = await env.DB.prepare(
			`SELECT om.role
			 FROM organization_memberships AS om
			 JOIN users AS u ON u.id = om.user_id
			 WHERE om.organization_id = 'org-one' AND u.email = ?1`,
		)
			.bind("new.member@example.org")
			.first<{ role: string }>();
		expect(membership?.role).toBe("contributor");

		const acceptedAuditCount = await env.DB.prepare(
			"SELECT count(*) AS count FROM audit_log WHERE action = 'invitation.accepted'",
		).first<number>("count");
		expect(acceptedAuditCount).toBe(1);
	});

	it("expires an older pending link when an invitation is reissued", async () => {
		await seedSiteAdmin();
		const first = await createInvitation(env, siteAdmin, {
			email: "new.member@example.org",
			organizationId: null,
			invitedRole: "viewer",
		});
		const second = await createInvitation(env, siteAdmin, {
			email: "new.member@example.org",
			organizationId: null,
			invitedRole: "viewer",
		});

		await expect(getInvitationByToken(env, first.token)).resolves.toBeNull();
		await expect(getInvitationByToken(env, second.token)).resolves.not.toBeNull();
	});

	it("does not invite an active or suspended account", async () => {
		await seedSiteAdmin();
		await seedUser("active");
		await expect(
			createInvitation(env, siteAdmin, {
				email: activeUser.email,
				organizationId: null,
				invitedRole: "viewer",
			}),
		).rejects.toMatchObject({ reason: "active" });

		await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?1")
			.bind(activeUser.id)
			.run();
		await expect(
			createInvitation(env, siteAdmin, {
				email: activeUser.email,
				organizationId: null,
				invitedRole: "viewer",
			}),
		).rejects.toMatchObject({
			reason: "suspended",
		});
	});
});

describe("member access management", () => {
	it("suspends a member, revokes sessions, and records the actor", async () => {
		await seedSiteAdmin();
		await seedUser();
		await createUserSession(env, activeUser);

		await expect(
			changeMemberStatus(env, siteAdmin, {
				targetUserId: activeUser.id,
				nextStatus: "suspended",
			}),
		).resolves.toEqual({
			targetUserId: activeUser.id,
			previousStatus: "active",
			nextStatus: "suspended",
		});

		const member = await env.DB.prepare(
			"SELECT status FROM users WHERE id = ?1",
		)
			.bind(activeUser.id)
			.first<{ status: string }>();
		expect(member?.status).toBe("suspended");
		const activeSessions = await env.DB.prepare(
			"SELECT count(*) AS count FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL",
		)
			.bind(activeUser.id)
			.first<number>("count");
		expect(activeSessions).toBe(0);

		const events = await listMemberAccessAudit(env);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			action: "member.suspended",
			targetEmail: activeUser.email,
			actorEmail: siteAdmin.email,
		});
	});

	it("restores a suspended member without creating a session", async () => {
		await seedSiteAdmin();
		await seedUser("suspended");

		await changeMemberStatus(env, siteAdmin, {
			targetUserId: activeUser.id,
			nextStatus: "active",
		});

		const members = await listManagedMembers(env);
		expect(members.find((member) => member.id === activeUser.id)?.status).toBe(
			"active",
		);
		const sessionCount = await env.DB.prepare(
			"SELECT count(*) AS count FROM sessions WHERE user_id = ?1",
		)
			.bind(activeUser.id)
			.first<number>("count");
		expect(sessionCount).toBe(0);
	});

	it("blocks self-suspension and invalid status transitions", async () => {
		await seedSiteAdmin();
		await seedUser("invited");

		await expect(
			changeMemberStatus(env, siteAdmin, {
				targetUserId: siteAdmin.id,
				nextStatus: "suspended",
			}),
		).rejects.toMatchObject({ reason: "self-suspension" });
		await expect(
			changeMemberStatus(env, siteAdmin, {
				targetUserId: activeUser.id,
				nextStatus: "active",
			}),
		).rejects.toMatchObject({ reason: "invalid-transition" });
	});

	it("allows one administrator to suspend another while one remains active", async () => {
		await seedSiteAdmin();
		await seedAdditionalSiteAdmin();

		await changeMemberStatus(env, siteAdmin, {
			targetUserId: "user-admin-two",
			nextStatus: "suspended",
		});

		const activeAdminCount = await env.DB.prepare(
			`SELECT count(*) AS count
			 FROM users
			 WHERE site_role = 'site_admin' AND status = 'active'`,
		).first<number>("count");
		expect(activeAdminCount).toBe(1);
	});
});

describe("organization administration", () => {
	it("creates and updates a live organization profile with audit records", async () => {
		await seedSiteAdmin();
		const created = await createOrganization(env, siteAdmin, {
			name: "Seacoast Pride",
			slug: "seacoast-pride",
			summary: "Community on the coast",
			websiteUrl: "https://example.org",
			contactEmail: "hello@example.org",
		});

		await updateOrganization(env, siteAdmin, {
			organizationId: created.id,
			name: "Seacoast Pride NH",
			slug: "seacoast-pride-nh",
			summary: "Updated summary",
			description: "A longer organization profile.",
			websiteUrl: "https://example.org",
			contactEmail: "hello@example.org",
			status: "active",
		});

		const profile = await getOrganizationBySlug(env, "seacoast-pride-nh", siteAdmin);
		expect(profile?.organization).toMatchObject({
			name: "Seacoast Pride NH",
			description: "A longer organization profile.",
			memberCount: 0,
		});
		const auditCount = await env.DB.prepare(
			`SELECT count(*) AS count FROM audit_log
			 WHERE action IN ('organization.created', 'organization.updated')`,
		).first<number>("count");
		expect(auditCount).toBe(2);
	});

	it("adds, changes, and removes an active member role", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedOrganization();

		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: activeUser.id,
			role: "viewer",
		});
		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: activeUser.id,
			role: "org_admin",
		});

		const data = await getOrganizationAdministrationData(env);
		expect(data.memberships).toContainEqual(
			expect.objectContaining({
				organizationId: "org-one",
				userId: activeUser.id,
				role: "org_admin",
			}),
		);

		await removeOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: activeUser.id,
		});
		const membershipCount = await env.DB.prepare(
			"SELECT count(*) AS count FROM organization_memberships",
		).first<number>("count");
		expect(membershipCount).toBe(0);
		const auditCount = await env.DB.prepare(
			`SELECT count(*) AS count FROM audit_log
			 WHERE action LIKE 'organization.membership_%'`,
		).first<number>("count");
		expect(auditCount).toBe(3);
	});

	it("rejects suspended members and duplicate organization slugs", async () => {
		await seedSiteAdmin();
		await seedUser("suspended");
		await seedOrganization();

		await expect(
			setOrganizationMembership(env, siteAdmin, {
				organizationId: "org-one",
				userId: activeUser.id,
				role: "viewer",
			}),
		).rejects.toMatchObject({ reason: "member-unavailable" });
		await expect(
			createOrganization(env, siteAdmin, {
				name: "Duplicate",
				slug: "community-center",
				summary: null,
				websiteUrl: null,
				contactEmail: null,
			}),
		).rejects.toMatchObject({ reason: "slug-conflict" });
	});
});

describe("affiliation visibility and administration", () => {
	it("limits the directory to direct, inherited, or site-admin access", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedOrganization();
		await seedSecondOrganization();
		await seedAffiliation();
		await addOrganizationAffiliation(env, siteAdmin, {
			affiliationId: "aff-shared",
			organizationId: "org-one",
		});
		await addOrganizationAffiliation(env, siteAdmin, {
			affiliationId: "aff-shared",
			organizationId: "org-two",
		});

		await expect(listVisibleOrganizations(env, activeUser)).resolves.toEqual([]);
		await addUserAffiliation(env, siteAdmin, {
			affiliationId: "aff-shared",
			userId: activeUser.id,
		});
		await expect(listVisibleOrganizations(env, activeUser)).resolves.toHaveLength(2);

		await removeUserAffiliation(env, siteAdmin, {
			affiliationId: "aff-shared",
			userId: activeUser.id,
		});
		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: activeUser.id,
			role: "viewer",
		});
		const inherited = await listVisibleOrganizations(env, activeUser);
		expect(inherited.map((organization) => organization.id)).toEqual(["org-one", "org-two"]);
		await expect(listVisibleOrganizations(env, siteAdmin)).resolves.toHaveLength(2);
	});

	it("does not reveal hidden organization members to ordinary viewers", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember("hidden");
		await seedOrganization();
		await seedAffiliation();
		await addOrganizationAffiliation(env, siteAdmin, {
			affiliationId: "aff-shared",
			organizationId: "org-one",
		});
		await addUserAffiliation(env, siteAdmin, {
			affiliationId: "aff-shared",
			userId: activeUser.id,
		});
		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: secondMember.id,
			role: "contributor",
		});

		const memberView = await getOrganizationBySlug(env, "community-center", activeUser);
		expect(memberView?.members).toEqual([]);
		const adminView = await getOrganizationBySlug(env, "community-center", siteAdmin);
		expect(adminView?.members.map((member) => member.userId)).toContain(secondMember.id);
	});

	it("creates and assigns affiliations with audit records", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedOrganization();
		const created = await createAffiliation(env, siteAdmin, {
			name: "Regional Network",
			slug: "regional-network",
		});
		await updateAffiliation(env, siteAdmin, {
			affiliationId: created.id,
			name: "Regional Coalition",
			slug: "regional-coalition",
		});
		await addOrganizationAffiliation(env, siteAdmin, {
			affiliationId: created.id,
			organizationId: "org-one",
		});
		await addUserAffiliation(env, siteAdmin, {
			affiliationId: created.id,
			userId: activeUser.id,
		});

		const data = await getAffiliationAdministrationData(env);
		expect(data.affiliations[0]).toMatchObject({
			name: "Regional Coalition",
			organizationCount: 1,
			directMemberCount: 1,
			effectiveMemberCount: 1,
		});
		await removeOrganizationAffiliation(env, siteAdmin, {
			affiliationId: created.id,
			organizationId: "org-one",
		});
		await removeUserAffiliation(env, siteAdmin, {
			affiliationId: created.id,
			userId: activeUser.id,
		});
		const auditCount = await env.DB.prepare(
			"SELECT count(*) AS count FROM audit_log WHERE action LIKE 'affiliation.%'",
		).first<number>("count");
		expect(auditCount).toBe(6);
	});

	it("rejects affiliation mutations from ordinary members", async () => {
		await seedUser();
		await expect(
			createAffiliation(env, activeUser, {
				name: "Unauthorized Network",
				slug: "unauthorized-network",
			}),
		).rejects.toMatchObject({ reason: "forbidden" });
	});
});

describe("organization-admin self-service", () => {
	it("lets organization admins update profiles and manage visible members", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedOrganization();
		await seedAffiliation();
		await addOrganizationAffiliation(env, siteAdmin, {
			affiliationId: "aff-shared",
			organizationId: "org-one",
		});
		await addUserAffiliation(env, siteAdmin, {
			affiliationId: "aff-shared",
			userId: secondMember.id,
		});
		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: activeUser.id,
			role: "org_admin",
		});

		const management = await getOrganizationManagementData(env, activeUser, "community-center");
		expect(management?.availableMembers.map((member) => member.id)).toContain(secondMember.id);
		await updateManagedOrganizationProfile(env, activeUser, {
			organizationId: "org-one",
			name: "Community Center NH",
			summary: "Updated by its administrator",
			description: null,
			websiteUrl: null,
			contactEmail: null,
		});
		await setOrganizationMembership(env, activeUser, {
			organizationId: "org-one",
			userId: secondMember.id,
			role: "contributor",
		});
		const profile = await getOrganizationBySlug(env, "community-center", activeUser);
		expect(profile?.organization.name).toBe("Community Center NH");
		expect(profile?.members.map((member) => member.userId)).toContain(secondMember.id);
		await expect(listManagedOrganizations(env, activeUser)).resolves.toEqual([
			{ name: "Community Center NH", slug: "community-center" },
		]);
	});

	it("blocks cross-organization changes and self-demotion", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedOrganization();
		await seedSecondOrganization();
		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: activeUser.id,
			role: "org_admin",
		});

		await expect(
			updateManagedOrganizationProfile(env, activeUser, {
				organizationId: "org-two",
				name: "Unauthorized",
				summary: null,
				description: null,
				websiteUrl: null,
				contactEmail: null,
			}),
		).rejects.toMatchObject({ reason: "forbidden" });
		await expect(
			setOrganizationMembership(env, activeUser, {
				organizationId: "org-one",
				userId: activeUser.id,
				role: "viewer",
			}),
		).rejects.toMatchObject({ reason: "self-management" });
		await expect(
			removeOrganizationMembership(env, activeUser, {
				organizationId: "org-one",
				userId: activeUser.id,
			}),
		).rejects.toMatchObject({ reason: "self-management" });
	});
});
