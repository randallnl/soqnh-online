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
import {
	cancelOrganizationClaim,
	listClaimableOrganizations,
	listOwnOrganizationClaims,
	listReviewableOrganizationClaims,
	reviewOrganizationClaim,
	submitOrganizationClaim,
} from "../app/models/organization-claims.server";
import { normalizeTags } from "../app/lib/content";
import { eventReviewSchema } from "../app/lib/event-review";
import {
	archivePost,
	createPost,
	getPostById,
	listPostOrganizations,
	listSectionPosts,
	updatePost,
} from "../app/models/posts.server";
import {
	archiveComment,
	createComment,
	listPostComments,
	updateComment,
} from "../app/models/comments.server";
import {
	listMentionableMembers,
	togglePostSupport,
} from "../app/models/interactions.server";
import {
	countUnreadNotifications,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
} from "../app/models/notifications.server";
import {
	canModerateEvents,
	listPendingEvents,
	removeEvent,
	reviewEvent,
} from "../app/models/events.server";
import {
	canReadIdentityObject,
	getVisibleMemberProfile,
	listVisibleMembers,
	isOwnProfileComplete,
	updateOwnProfile,
} from "../app/models/profiles.server";
import {
	getAdminOperationsData,
	listAuditEvents,
} from "../app/models/admin.server";
import {
	importScraperRecords,
	listScraperPartners,
	updateOrganizationScraperSettings,
} from "../app/models/scraper.server";
import { getDashboardData } from "../app/models/dashboard.server";

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

const thirdMember = {
	id: "user-third",
	email: "third@example.org",
	name: "Third Member",
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

async function seedThirdMember() {
	await env.DB.prepare(
		`INSERT INTO users
		 (id, email, name, site_role, status, created_at, updated_at, profile_visibility)
		 VALUES (?1, ?2, ?3, 'member', 'active', ?4, ?4, 'members')`,
	)
		.bind(thirdMember.id, thirdMember.email, thirdMember.name, new Date().toISOString())
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
		env.DB.prepare("DELETE FROM scraper_imports"),
		env.DB.prepare("DELETE FROM scraper_runs"),
		env.DB.prepare("DELETE FROM notifications"),
		env.DB.prepare("DELETE FROM post_mentions"),
		env.DB.prepare("DELETE FROM attachments"),
		env.DB.prepare("DELETE FROM comments"),
		env.DB.prepare("DELETE FROM post_reactions"),
		env.DB.prepare("DELETE FROM post_tags"),
		env.DB.prepare("DELETE FROM post_affiliations"),
		env.DB.prepare("DELETE FROM events"),
		env.DB.prepare("DELETE FROM projects"),
		env.DB.prepare("DELETE FROM video_embeds"),
		env.DB.prepare("DELETE FROM posts"),
		env.DB.prepare("DELETE FROM sessions"),
		env.DB.prepare("DELETE FROM auth_tokens"),
		env.DB.prepare("DELETE FROM organization_affiliations"),
		env.DB.prepare("DELETE FROM user_affiliations"),
		env.DB.prepare("DELETE FROM organization_membership_claims"),
		env.DB.prepare("DELETE FROM organization_memberships"),
		env.DB.prepare("DELETE FROM invitations"),
		env.DB.prepare("DELETE FROM users"),
		env.DB.prepare("DELETE FROM organizations"),
		env.DB.prepare("DELETE FROM affiliations"),
	]);
});

describe("member profiles", () => {
	it("limits the directory and profile assets to shared affiliations", async () => {
		await Promise.all([seedUser(), seedSecondMember(), seedThirdMember()]);
		await seedSiteAdmin();
		await seedAffiliation();
		await seedAffiliation("aff-other", "Other Coalition", "other-coalition");
		const now = new Date().toISOString();
		await env.DB.batch([
			env.DB.prepare("INSERT INTO user_affiliations (user_id, affiliation_id, created_at) VALUES (?1, ?2, ?3)").bind(activeUser.id, "aff-shared", now),
			env.DB.prepare("INSERT INTO user_affiliations (user_id, affiliation_id, created_at) VALUES (?1, ?2, ?3)").bind(secondMember.id, "aff-shared", now),
			env.DB.prepare("INSERT INTO user_affiliations (user_id, affiliation_id, created_at) VALUES (?1, ?2, ?3)").bind(thirdMember.id, "aff-other", now),
			env.DB.prepare("UPDATE users SET avatar_object_key = 'profile-photos/second.jpg' WHERE id = ?1").bind(secondMember.id),
		]);

		const memberDirectory = await listVisibleMembers(env, activeUser);
		expect(memberDirectory).toSatisfy((members: Awaited<ReturnType<typeof listVisibleMembers>>) =>
			members.map((member) => member.id).sort().join(",") === "user-active,user-second",
		);
		expect(memberDirectory.find((member) => member.id === activeUser.id)?.affiliationNames).toBe("Shared Coalition");
		expect(memberDirectory.find((member) => member.id === secondMember.id)?.affiliationNames).toBeNull();

		const privateMemberProfile = await getVisibleMemberProfile(env, activeUser, secondMember.id);
		expect(privateMemberProfile).toMatchObject({ affiliationNames: null, affiliations: [] });
		const ownProfile = await getVisibleMemberProfile(env, activeUser, activeUser.id);
		expect(ownProfile?.affiliations.map((affiliation) => affiliation.id)).toEqual(["aff-shared"]);
		const adminProfile = await getVisibleMemberProfile(env, siteAdmin, secondMember.id);
		expect(adminProfile?.affiliations.map((affiliation) => affiliation.id)).toEqual(["aff-shared"]);
		await expect(getVisibleMemberProfile(env, activeUser, thirdMember.id)).resolves.toBeNull();
		await expect(canReadIdentityObject(env, activeUser, "profile-photos/second.jpg")).resolves.toBe(true);
		await expect(canReadIdentityObject(env, thirdMember, "profile-photos/second.jpg")).resolves.toBe(false);
	});

	it("updates a member's own directory profile and direct affiliations", async () => {
		await seedUser();
		await seedAffiliation();
		await expect(isOwnProfileComplete(env, activeUser)).resolves.toBe(false);
		await updateOwnProfile(env, activeUser, {
			name: "Updated Member",
			profileTitle: "Community organizer",
			pronouns: "they/them",
			bio: "Building durable community connections.",
			location: "Concord, NH",
			websiteUrl: "https://example.org",
			profileVisibility: "hidden",
			affiliationIds: ["aff-shared"],
			avatarObjectKey: "profile-photos/user-active.jpg",
		});

		await expect(getVisibleMemberProfile(env, activeUser, activeUser.id)).resolves.toMatchObject({
			name: "Updated Member",
			profileTitle: "Community organizer",
			profileVisibility: "hidden",
			avatarObjectKey: "profile-photos/user-active.jpg",
		});
		await expect(env.DB.prepare("SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1").bind(activeUser.id).first<string>("affiliation_id")).resolves.toBe("aff-shared");
		await expect(isOwnProfileComplete(env, activeUser)).resolves.toBe(true);
	});
});

describe("organization membership claims", () => {
	it("keeps a self-selected role pending until a site administrator approves it", async () => {
		await Promise.all([seedUser(), seedSiteAdmin()]);
		await seedOrganization();
		expect(await listClaimableOrganizations(env, activeUser)).toEqual([]);
		await expect(submitOrganizationClaim(env, activeUser, { organizationId: "org-one", requestedRole: "viewer" })).rejects.toMatchObject({ reason: "organization-unavailable" });
		await seedAffiliation();
		await addOrganizationAffiliation(env, siteAdmin, { affiliationId: "aff-shared", organizationId: "org-one" });
		await addUserAffiliation(env, siteAdmin, { affiliationId: "aff-shared", userId: activeUser.id });

		const claimable = await listClaimableOrganizations(env, activeUser);
		expect(claimable).toEqual([expect.objectContaining({ id: "org-one", currentRole: null, hasPendingClaim: false })]);
		const claim = await submitOrganizationClaim(env, activeUser, {
			organizationId: "org-one",
			requestedRole: "contributor",
		});
		expect(await env.DB.prepare("SELECT role FROM organization_memberships WHERE organization_id = 'org-one' AND user_id = ?1").bind(activeUser.id).first()).toBeNull();
		expect(await listOwnOrganizationClaims(env, activeUser)).toEqual([
			expect.objectContaining({ id: claim.id, status: "pending", requestedRole: "contributor" }),
		]);
		expect(await listReviewableOrganizationClaims(env, siteAdmin)).toEqual([
			expect.objectContaining({ id: claim.id, userId: activeUser.id }),
		]);

		await reviewOrganizationClaim(env, siteAdmin, { claimId: claim.id, decision: "approve", reason: null });
		expect(await env.DB.prepare("SELECT role FROM organization_memberships WHERE organization_id = 'org-one' AND user_id = ?1").bind(activeUser.id).first<string>("role")).toBe("contributor");
		expect((await listOwnOrganizationClaims(env, activeUser))[0]).toMatchObject({ status: "approved" });
		expect(await listNotifications(env, activeUser)).toEqual([expect.objectContaining({ type: "approval", body: expect.stringContaining("approved") })]);
		expect(await env.DB.prepare("SELECT count(*) AS count FROM audit_log WHERE action IN ('organization.claim_submitted', 'organization.claim_approved')").first<number>("count")).toBe(2);
	});

	it("scopes review to the organization and prevents self-approval", async () => {
		await Promise.all([seedUser(), seedSiteAdmin(), seedSecondMember(), seedThirdMember()]);
		await seedOrganization();
		await seedSecondOrganization();
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: secondMember.id, role: "org_admin" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-two", userId: thirdMember.id, role: "org_admin" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "viewer" });
		const claim = await submitOrganizationClaim(env, activeUser, { organizationId: "org-one", requestedRole: "org_admin" });

		expect((await listReviewableOrganizationClaims(env, secondMember)).map((item) => item.id)).toEqual([claim.id]);
		expect(await listReviewableOrganizationClaims(env, thirdMember)).toEqual([]);
		await expect(reviewOrganizationClaim(env, thirdMember, { claimId: claim.id, decision: "approve", reason: null })).rejects.toMatchObject({ reason: "forbidden" });
		await expect(reviewOrganizationClaim(env, activeUser, { claimId: claim.id, decision: "approve", reason: null })).rejects.toMatchObject({ reason: "self-review" });
	});

	it("supports cancellation and resubmission after a rejected claim", async () => {
		await Promise.all([seedUser(), seedSiteAdmin()]);
		await seedOrganization();
		await seedAffiliation();
		await addOrganizationAffiliation(env, siteAdmin, { affiliationId: "aff-shared", organizationId: "org-one" });
		await addUserAffiliation(env, siteAdmin, { affiliationId: "aff-shared", userId: activeUser.id });
		const first = await submitOrganizationClaim(env, activeUser, { organizationId: "org-one", requestedRole: "viewer" });
		await expect(submitOrganizationClaim(env, activeUser, { organizationId: "org-one", requestedRole: "contributor" })).rejects.toMatchObject({ reason: "already-pending" });
		await cancelOrganizationClaim(env, activeUser, first.id);
		const second = await submitOrganizationClaim(env, activeUser, { organizationId: "org-one", requestedRole: "contributor" });
		await reviewOrganizationClaim(env, siteAdmin, { claimId: second.id, decision: "reject", reason: "Please confirm your role with the organization." });
		const third = await submitOrganizationClaim(env, activeUser, { organizationId: "org-one", requestedRole: "viewer" });
		expect(third.id).not.toBe(second.id);
	});
});

describe("admin operations", () => {
	it("summarizes pending work and recent system activity", async () => {
		await Promise.all([seedUser(), seedSiteAdmin(), seedSecondMember()]);
		await seedOrganization();
		await seedAffiliation();
		const now = new Date().toISOString();
		const future = new Date(Date.now() + 86_400_000).toISOString();
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO organization_membership_claims
				 (id, organization_id, user_id, requested_role, status, created_at, updated_at)
				 VALUES ('claim-ops', 'org-one', ?1, 'viewer', 'pending', ?2, ?2)`,
			).bind(activeUser.id, now),
			env.DB.prepare(
				`INSERT INTO invitations
				 (id, email, invited_role, token_hash, invited_by_user_id, expires_at, created_at)
				 VALUES ('invite-ops', 'pending@example.org', 'viewer', 'ops-token', ?1, ?2, ?3)`,
			).bind(siteAdmin.id, future, now),
			env.DB.prepare(
				`INSERT INTO posts
				 (id, organization_id, author_user_id, section, title, body, visibility, status, created_at, updated_at)
				 VALUES ('00000000-0000-4000-8000-000000000099', 'org-one', ?1, 'event', 'Pending event', 'Review me', 'members', 'draft', ?2, ?2)`,
			).bind(activeUser.id, now),
			env.DB.prepare(
				`INSERT INTO events (post_id, starts_at, moderation_status)
				 VALUES ('00000000-0000-4000-8000-000000000099', ?1, 'pending')`,
			).bind(future),
			env.DB.prepare(
				`INSERT INTO scraper_runs
				 (id, trigger_type, status, failure_count, error_message, started_at, created_at, updated_at)
				 VALUES ('run-ops', 'manual', 'failed', 1, 'Partner timeout', ?1, ?1, ?1)`,
			).bind(now),
			env.DB.prepare(
				`INSERT INTO audit_log
				 (id, actor_user_id, action, entity_type, entity_id, created_at)
				 VALUES ('audit-ops', ?1, 'organization.updated', 'organization', 'org-one', ?2)`,
			).bind(siteAdmin.id, now),
		]);

		const data = await getAdminOperationsData(env);
		expect(data.metrics).toMatchObject({
			activeMembers: 3,
			activeOrganizations: 1,
			organizationsWithoutAffiliations: 1,
			affiliations: 1,
			draftPosts: 1,
				pendingEvents: 1,
				pendingOrganizationClaims: 1,
			activeInvitations: 1,
		});
		expect(data.latestScraperRun).toMatchObject({ status: "failed", errorMessage: "Partner timeout" });
		expect(data.recentAuditEvents[0]).toMatchObject({ action: "organization.updated", entityLabel: "Community Center" });
	});

	it("filters the audit viewer by entity type", async () => {
		await Promise.all([seedUser(), seedSiteAdmin()]);
		const now = new Date().toISOString();
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, created_at)
				 VALUES ('audit-user-ops', ?1, 'member.restored', 'user', ?2, ?3)`,
			).bind(siteAdmin.id, activeUser.id, now),
			env.DB.prepare(
				`INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, created_at)
				 VALUES ('audit-session-ops', ?1, 'auth.login_succeeded', 'session', 'session-1', ?2)`,
			).bind(activeUser.id, now),
		]);

		const result = await listAuditEvents(env, { entityType: "user", page: 1 });
		expect(result.total).toBe(1);
		expect(result.events).toHaveLength(1);
		expect(result.events[0]).toMatchObject({ entityType: "user", entityLabel: "Test Member" });
	});
});

describe("partner event scraper imports", () => {
	const scrapedEvent = {
		partner: "Community Center",
		title: "Queer Community Picnic",
		start_date: "2026-09-12",
		end_date: "",
		start_time: "13:30",
		end_time: "",
		location: "Concord, NH",
		description: "An afternoon together.",
		image_url: "https://example.org/picnic.jpg",
		url: "https://example.org/events/picnic",
		source_url: "https://example.org/events",
		kind: "event",
		scraped_at: "2026-08-13T18:00:00Z",
	};

	it("publishes only enabled active organizations to the scraper", async () => {
		await seedSiteAdmin();
		await seedOrganization();
		await updateOrganizationScraperSettings(env, siteAdmin, {
			organizationId: "org-one",
			eventSourceUrl: "https://example.org/events",
			eventParser: "generic_links",
			eventScrapingEnabled: true,
		});

		await expect(listScraperPartners(env)).resolves.toEqual([
			{ name: "Community Center", url: "https://example.org/events", parser: "generic_links" },
		]);
	});

	it("imports new events into moderation and updates a pending repeat", async () => {
		await seedOrganization();
		const first = await importScraperRecords(env, [scrapedEvent], null);
		expect(first).toMatchObject({ imported: 1, new: 1, updated: 0, skipped: 0 });

		const imported = await env.DB.prepare(
			`SELECT p.title, p.body, p.status, e.starts_at AS startsAt,
			 e.moderation_status AS moderationStatus
			 FROM posts AS p JOIN events AS e ON e.post_id = p.id
			 WHERE p.author_user_id = 'system:event-scraper'`,
		).first<{ title: string; body: string; status: string; startsAt: string; moderationStatus: string }>();
		expect(imported).toMatchObject({
			title: "Queer Community Picnic",
			status: "draft",
			startsAt: "2026-09-12T13:30",
			moderationStatus: "pending",
		});

		const repeat = await importScraperRecords(env, [{ ...scrapedEvent, description: "Updated details." }], null);
		expect(repeat).toMatchObject({ imported: 1, new: 0, updated: 1, skipped: 0 });
		await expect(env.DB.prepare(
			"SELECT body FROM posts WHERE author_user_id = 'system:event-scraper'",
		).first<string>("body")).resolves.toBe("Updated details.");
	});

	it("does not overwrite an approved scraper event", async () => {
		await seedOrganization();
		await importScraperRecords(env, [scrapedEvent], null);
		const postId = await env.DB.prepare(
			"SELECT post_id AS postId FROM events LIMIT 1",
		).first<string>("postId");
		await env.DB.batch([
			env.DB.prepare("UPDATE events SET moderation_status = 'approved' WHERE post_id = ?1").bind(postId),
			env.DB.prepare("UPDATE posts SET status = 'published' WHERE id = ?1").bind(postId),
		]);

		const result = await importScraperRecords(env, [{ ...scrapedEvent, title: "Changed title" }], null);
		expect(result).toMatchObject({ imported: 0, new: 0, updated: 0, skipped: 1, duplicates: 1 });
		await expect(env.DB.prepare("SELECT title FROM posts WHERE id = ?1").bind(postId).first<string>("title"))
			.resolves.toBe("Queer Community Picnic");
	});
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
		await expect(isOwnProfileComplete(env, accepted!)).resolves.toBe(false);
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

describe("content feeds and post permissions", () => {
	it("shows shared-network posts through direct or inherited affiliations", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedThirdMember();
		await seedOrganization();
		await seedAffiliation();
		await addOrganizationAffiliation(env, siteAdmin, { affiliationId: "aff-shared", organizationId: "org-one" });
		await addUserAffiliation(env, siteAdmin, { affiliationId: "aff-shared", userId: secondMember.id });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });

		const created = await createPost(env, activeUser, {
			organizationId: "org-one",
			section: "update",
			title: "A shared network update",
			body: "This update is visible across the shared coalition.",
			visibility: "members",
			status: "published",
			tags: ["network"],
			affiliationIds: ["aff-shared"],
		});
		const authorFeed = await listSectionPosts(env, activeUser, { section: "update", tag: null, organizationId: null, page: 1 });
		const sharedFeed = await listSectionPosts(env, secondMember, { section: "update", tag: null, organizationId: null, page: 1 });
		const unrelatedFeed = await listSectionPosts(env, thirdMember, { section: "update", tag: null, organizationId: null, page: 1 });
		expect(authorFeed.posts.map((post) => post.id)).toContain(created.id);
		expect(authorFeed.posts[0]?.affiliations).toEqual([{ id: "aff-shared", name: "Shared Coalition", slug: "shared-coalition" }]);
		expect(sharedFeed.posts.map((post) => post.id)).toContain(created.id);
		expect(unrelatedFeed.posts).toEqual([]);
		expect((await listSectionPosts(env, secondMember, { section: "update", tag: null, organizationId: null, affiliationIds: ["aff-shared"], page: 1 })).posts).toHaveLength(1);
		expect((await listSectionPosts(env, secondMember, { section: "update", tag: null, organizationId: null, affiliationIds: [], page: 1 })).posts).toEqual([]);
	});

	it("requires shared content to use affiliations available to the author", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedOrganization();
		await seedAffiliation();
		await seedAffiliation("aff-other", "Other Coalition", "other-coalition");
		await addOrganizationAffiliation(env, siteAdmin, { affiliationId: "aff-shared", organizationId: "org-one" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });
		const input = {
			organizationId: "org-one",
			section: "update" as const,
			title: "Affiliation-scoped update",
			body: "This update must have an authorized affiliation audience.",
			visibility: "members" as const,
			status: "published" as const,
			tags: [],
		};

		await expect(createPost(env, activeUser, { ...input, affiliationIds: [] })).rejects.toMatchObject({ reason: "affiliation-required" });
		await expect(createPost(env, activeUser, { ...input, affiliationIds: ["aff-other"] })).rejects.toMatchObject({ reason: "affiliation-unavailable" });
		await expect(createPost(env, activeUser, { ...input, affiliationIds: ["aff-shared"] })).resolves.toHaveProperty("id");
	});

	it("requires direct membership for organization-only posts", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedOrganization();
		await seedAffiliation();
		await addOrganizationAffiliation(env, siteAdmin, { affiliationId: "aff-shared", organizationId: "org-one" });
		await addUserAffiliation(env, siteAdmin, { affiliationId: "aff-shared", userId: secondMember.id });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });
		const created = await createPost(env, activeUser, {
			organizationId: "org-one",
			section: "project",
			title: "Internal project coordination",
			body: "Only direct organization members should see this post.",
			visibility: "organization",
			status: "published",
			tags: ["internal"],
		});

		await expect(getPostById(env, secondMember, created.id)).resolves.toBeNull();
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: secondMember.id, role: "viewer" });
		await expect(getPostById(env, secondMember, created.id)).resolves.toMatchObject({ id: created.id });
	});

	it("enforces contributor authoring and organization-admin editing", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedOrganization();
		await expect(listPostOrganizations(env, activeUser)).resolves.toEqual([]);
		await expect(createPost(env, activeUser, {
			organizationId: "org-one", section: "legislation", title: "Unauthorized post", body: "This should not be created.", visibility: "members", status: "published", tags: [],
		})).rejects.toMatchObject({ reason: "organization-unavailable" });

		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: secondMember.id, role: "org_admin" });
		const created = await createPost(env, activeUser, {
			organizationId: "org-one", section: "legislation", title: "Policy briefing", body: "A detailed policy briefing for the network.", visibility: "members", status: "draft", tags: ["policy"],
		});
		await updatePost(env, secondMember, {
			postId: created.id, organizationId: "org-one", title: "Published policy briefing", body: "The organization administrator reviewed this briefing.", visibility: "members", status: "published", tags: ["policy", "action"],
		});
		await expect(getPostById(env, activeUser, created.id)).resolves.toMatchObject({ title: "Published policy briefing", status: "published", tags: ["action", "policy"] });
	});

	it("filters tags, paginates, archives, and audits post changes", async () => {
		await seedSiteAdmin();
		await seedUser();
		for (let index = 0; index < 11; index += 1) {
			await createPost(env, siteAdmin, {
				organizationId: null,
				section: "update",
				title: `Ecosystem update ${index}`,
				body: "An ecosystem-wide update with enough detail to publish.",
				visibility: "members",
				status: "published",
				tags: index === 0 ? normalizeTags("Mutual Aid, mutual aid, invalid tag!") : ["general"],
			});
		}
		const firstPage = await listSectionPosts(env, activeUser, { section: "update", tag: null, organizationId: null, page: 1 });
		const secondPage = await listSectionPosts(env, activeUser, { section: "update", tag: null, organizationId: null, page: 2 });
		expect(firstPage.posts).toHaveLength(10);
		expect(secondPage.posts).toHaveLength(1);
		expect(firstPage.totalPages).toBe(2);
		const filtered = await listSectionPosts(env, activeUser, { section: "update", tag: "mutual-aid", organizationId: null, page: 1 });
		expect(filtered.posts).toHaveLength(1);
		await archivePost(env, siteAdmin, filtered.posts[0]!.id);
		const afterArchive = await listSectionPosts(env, activeUser, { section: "update", tag: "mutual-aid", organizationId: null, page: 1 });
		expect(afterArchive.posts).toEqual([]);
		const auditCount = await env.DB.prepare("SELECT count(*) AS count FROM audit_log WHERE action IN ('post.created', 'post.archived')").first<number>("count");
		expect(auditCount).toBe(12);
	});
});

describe("event moderation", () => {
	const eventDetails = {
		startsAt: "2026-09-12T18:00",
		endsAt: "2026-09-12T20:00",
		locationName: "Community Hall, Concord",
		locationUrl: "https://example.org/location",
		registrationUrl: "https://example.org/register",
		sourceUrl: "https://example.org/event",
		imageUrl: "https://example.org/event.jpg",
	};

	it("accepts UUID and scraper event review forms", () => {
		expect(eventReviewSchema.safeParse({
			postId: "123e4567-e89b-42d3-a456-426614174000",
			decision: "approve",
		}).success).toBe(true);
		expect(eventReviewSchema.safeParse({
			postId: `scraped:${"a".repeat(64)}`,
			decision: "reject",
			reason: "Add a specific location.",
		}).success).toBe(true);
	});

	it("requires a reason only when rejecting an event", () => {
		const result = eventReviewSchema.safeParse({
			postId: `scraped:${"b".repeat(64)}`,
			decision: "reject",
			reason: "   ",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe("Explain what needs to change before rejecting the event");
		}
	});

	it("defaults the event feed to upcoming events and applies the date filter", async () => {
		await seedSiteAdmin();
		const createApprovedEvent = async (title: string, startsAt: string) => {
			const event = await createPost(env, siteAdmin, {
				organizationId: null,
				section: "event",
				title,
				body: `${title} details for the community calendar.`,
				visibility: "members",
				status: "published",
				tags: [],
				event: {
					startsAt,
					endsAt: null,
					locationName: null,
					locationUrl: null,
					registrationUrl: null,
					sourceUrl: null,
					imageUrl: null,
				},
			});
			await reviewEvent(env, siteAdmin, { postId: event.id, decision: "approve", reason: null });
			return event.id;
		};
		const pastId = await createApprovedEvent("Past gathering", "2020-01-15T18:00");
		const upcomingId = await createApprovedEvent("Upcoming gathering", "2099-01-15T18:00");
		const baseInput = { section: "event" as const, tag: null, organizationId: null, page: 1 };

		expect((await listSectionPosts(env, siteAdmin, baseInput)).posts.map((post) => post.id)).toEqual([upcomingId]);
		expect((await listSectionPosts(env, siteAdmin, { ...baseInput, eventTiming: "past" })).posts.map((post) => post.id)).toEqual([pastId]);
		expect((await listSectionPosts(env, siteAdmin, { ...baseInput, eventTiming: "all" })).posts.map((post) => post.id)).toEqual([pastId, upcomingId]);
	});

	it("keeps submitted events private until an organization admin approves them", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedThirdMember();
		await seedOrganization();
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: secondMember.id, role: "org_admin" });

		const event = await createPost(env, activeUser, {
			organizationId: "org-one", section: "event", title: "Queer community gathering",
			body: "An evening gathering for community connection and shared learning.",
			visibility: "members", status: "published", tags: ["community"], event: eventDetails,
		});
		await expect(getPostById(env, activeUser, event.id)).resolves.toMatchObject({
			status: "draft", eventModerationStatus: "pending", eventStartsAt: eventDetails.startsAt,
		});
		expect((await listSectionPosts(env, activeUser, { section: "event", tag: null, organizationId: null, page: 1 })).posts).toEqual([]);
		expect((await listPendingEvents(env, secondMember)).map((item) => item.postId)).toContain(event.id);
		expect(await listPendingEvents(env, thirdMember)).toEqual([]);
		await expect(reviewEvent(env, thirdMember, { postId: event.id, decision: "approve", reason: null })).rejects.toMatchObject({ reason: "forbidden" });

		await reviewEvent(env, secondMember, { postId: event.id, decision: "approve", reason: null });
		await expect(getPostById(env, activeUser, event.id)).resolves.toMatchObject({ status: "published", eventModerationStatus: "approved" });
		expect((await listSectionPosts(env, activeUser, { section: "event", tag: null, organizationId: null, page: 1 })).posts[0]).toMatchObject({ id: event.id, eventLocationName: eventDetails.locationName });
		expect(await listNotifications(env, activeUser)).toEqual([expect.objectContaining({ type: "approval", postId: event.id })]);
		expect(await env.DB.prepare("SELECT count(*) AS count FROM audit_log WHERE entity_id = ?1 AND action IN ('event.submitted', 'event.approved')").bind(event.id).first<number>("count")).toBe(2);
	});

	it("returns rejected and edited events to the queue with a visible reason", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedOrganization();
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });
		const event = await createPost(env, activeUser, {
			organizationId: "org-one", section: "event", title: "Draft event listing",
			body: "This listing needs a clearer location before it can be published.",
			visibility: "members", status: "draft", tags: [], event: eventDetails,
		});

		await reviewEvent(env, siteAdmin, { postId: event.id, decision: "reject", reason: "Confirm the accessible entrance." });
		await expect(getPostById(env, activeUser, event.id)).resolves.toMatchObject({
			status: "draft", eventModerationStatus: "rejected", eventRejectionReason: "Confirm the accessible entrance.",
		});
		await expect(reviewEvent(env, siteAdmin, { postId: event.id, decision: "approve", reason: null })).rejects.toMatchObject({ reason: "already-reviewed" });

		await updatePost(env, activeUser, {
			postId: event.id, organizationId: "org-one", title: "Accessible event listing",
			body: "The accessible entrance is on the east side of the community hall.",
			visibility: "members", status: "published", tags: ["accessible"],
			event: { ...eventDetails, locationName: "Community Hall, east entrance" },
		});
		await expect(getPostById(env, activeUser, event.id)).resolves.toMatchObject({ eventModerationStatus: "pending", eventRejectionReason: null });
		expect((await listPendingEvents(env, siteAdmin)).map((item) => item.postId)).toContain(event.id);
		expect(await canModerateEvents(env, activeUser)).toBe(false);
		expect(await canModerateEvents(env, siteAdmin)).toBe(true);
	});

	it("lets event authors and administrators remove events", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedThirdMember();
		await seedOrganization();
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: secondMember.id, role: "org_admin" });

		const createOwnedEvent = (title: string) => createPost(env, activeUser, {
			organizationId: "org-one",
			section: "event",
			title,
			body: `${title} details for the community calendar.`,
			visibility: "members",
			status: "published",
			tags: [],
			event: eventDetails,
		});

		const authorEvent = await createOwnedEvent("Author-managed event");
		await expect(removeEvent(env, thirdMember, authorEvent.id)).rejects.toMatchObject({ reason: "forbidden" });
		await removeEvent(env, activeUser, authorEvent.id);
		await expect(getPostById(env, activeUser, authorEvent.id)).resolves.toMatchObject({ status: "archived" });

		const organizationEvent = await createOwnedEvent("Organization-managed event");
		await removeEvent(env, secondMember, organizationEvent.id);
		await expect(getPostById(env, secondMember, organizationEvent.id)).resolves.toMatchObject({ status: "archived" });

		const administratorEvent = await createOwnedEvent("Administrator-managed event");
		await removeEvent(env, siteAdmin, administratorEvent.id);
		await expect(getPostById(env, siteAdmin, administratorEvent.id)).resolves.toMatchObject({ status: "archived" });

		expect(await listPendingEvents(env, siteAdmin)).toEqual([]);
		expect(await env.DB.prepare(
			"SELECT count(*) AS count FROM audit_log WHERE action = 'event.removed'",
		).first<number>("count")).toBe(3);
	});
});

describe("dashboard data", () => {
	it("returns live activity without exposing organization-only content", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedThirdMember();
		await seedOrganization();
		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: activeUser.id,
			role: "contributor",
		});

		const networkPost = await createPost(env, siteAdmin, {
			organizationId: null,
			section: "update",
			title: "Network-wide update",
			body: "A published update for every active member.",
			visibility: "members",
			status: "published",
			tags: [],
		});
		const privatePost = await createPost(env, activeUser, {
			organizationId: "org-one",
			section: "project",
			title: "Organization planning",
			body: "Private coordination for direct organization members.",
			visibility: "organization",
			status: "published",
			tags: [],
		});
		await createComment(env, activeUser, {
			postId: networkPost.id,
			body: "Thanks for sharing this update.",
			parentCommentId: null,
		});

		const memberDashboard = await getDashboardData(env, activeUser);
		expect(memberDashboard.recentPosts.map((post) => post.id)).toEqual(
			expect.arrayContaining([networkPost.id, privatePost.id]),
		);
		expect(memberDashboard.recentActivity).toEqual([
			expect.objectContaining({ postId: networkPost.id }),
		]);

		const unrelatedDashboard = await getDashboardData(env, thirdMember);
		expect(unrelatedDashboard.recentPosts.map((post) => post.id)).toContain(
			networkPost.id,
		);
		expect(unrelatedDashboard.recentPosts.map((post) => post.id)).not.toContain(
			privatePost.id,
		);
	});

	it("scopes moderation counts and lists only approved future events", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedOrganization();
		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: activeUser.id,
			role: "contributor",
		});
		await setOrganizationMembership(env, siteAdmin, {
			organizationId: "org-one",
			userId: secondMember.id,
			role: "org_admin",
		});
		const nextYear = new Date().getUTCFullYear() + 1;
		const event = await createPost(env, activeUser, {
			organizationId: "org-one",
			section: "event",
			title: "Future community gathering",
			body: "A future gathering that requires moderation.",
			visibility: "members",
			status: "published",
			tags: [],
			event: {
				startsAt: `${nextYear}-06-15T18:00`,
				endsAt: null,
				locationName: "Concord",
				locationUrl: null,
				registrationUrl: null,
				sourceUrl: null,
				imageUrl: null,
			},
		});

		expect((await getDashboardData(env, activeUser)).counts.pendingEvents).toBe(0);
		expect((await getDashboardData(env, secondMember)).counts.pendingEvents).toBe(1);
		expect((await getDashboardData(env, siteAdmin)).counts.pendingEvents).toBe(1);

		await reviewEvent(env, secondMember, {
			postId: event.id,
			decision: "approve",
			reason: null,
		});
		const dashboard = await getDashboardData(env, activeUser);
		expect(dashboard.counts.pendingEvents).toBe(0);
		expect(dashboard.counts.upcomingEvents).toBe(1);
		expect(dashboard.upcomingEvents).toEqual([
			expect.objectContaining({ postId: event.id, locationName: "Concord" }),
		]);
	});
});

describe("post conversations", () => {
	it("creates comments and one-level reply threads on visible published posts", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		const post = await createPost(env, siteAdmin, {
			organizationId: null, section: "update", title: "Community conversation", body: "A published update open to ecosystem conversation.", visibility: "members", status: "published", tags: [],
		});
		const root = await createComment(env, activeUser, { postId: post.id, parentCommentId: null, body: "Here is some useful context." });
		const reply = await createComment(env, secondMember, { postId: post.id, parentCommentId: root.id, body: "Thanks — this helps clarify the next step." });

		const comments = await listPostComments(env, activeUser, post.id);
		expect(comments).toHaveLength(1);
		expect(comments[0]).toMatchObject({ id: root.id, body: "Here is some useful context.", canEdit: true });
		expect(comments[0]?.replies[0]).toMatchObject({ id: reply.id, parentCommentId: root.id });
		await expect(createComment(env, activeUser, { postId: post.id, parentCommentId: reply.id, body: "A reply that is nested too deeply." })).rejects.toMatchObject({ reason: "invalid-parent" });
	});

	it("limits editing to authors and lets organization admins remove comments", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedThirdMember();
		await seedOrganization();
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: secondMember.id, role: "org_admin" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: thirdMember.id, role: "viewer" });
		const post = await createPost(env, activeUser, {
			organizationId: "org-one", section: "project", title: "Project discussion", body: "An organization project with a focused discussion.", visibility: "organization", status: "published", tags: [],
		});
		const root = await createComment(env, thirdMember, { postId: post.id, parentCommentId: null, body: "My first version of this comment." });
		const reply = await createComment(env, activeUser, { postId: post.id, parentCommentId: root.id, body: "A reply that should remain visible." });
		await expect(updateComment(env, activeUser, { postId: post.id, commentId: root.id, body: "Unauthorized rewrite." })).rejects.toMatchObject({ reason: "forbidden" });
		await updateComment(env, thirdMember, { postId: post.id, commentId: root.id, body: "My corrected comment." });
		await archiveComment(env, secondMember, { postId: post.id, commentId: root.id });

		const comments = await listPostComments(env, thirdMember, post.id);
		expect(comments[0]).toMatchObject({ id: root.id, body: null, status: "archived", canEdit: false, canDelete: false });
		expect(comments[0]?.replies[0]).toMatchObject({ id: reply.id, body: "A reply that should remain visible." });
	});

	it("blocks comments on drafts and records the comment lifecycle", async () => {
		await seedSiteAdmin();
		await seedUser();
		const draft = await createPost(env, siteAdmin, {
			organizationId: null, section: "legislation", title: "Draft policy note", body: "This draft is not open for conversation yet.", visibility: "members", status: "draft", tags: [],
		});
		await expect(createComment(env, siteAdmin, { postId: draft.id, parentCommentId: null, body: "Do not add this." })).rejects.toMatchObject({ reason: "post-unavailable" });
		const post = await createPost(env, siteAdmin, {
			organizationId: null, section: "legislation", title: "Published policy note", body: "This policy note is ready for member discussion.", visibility: "members", status: "published", tags: [],
		});
		const comment = await createComment(env, activeUser, { postId: post.id, parentCommentId: null, body: "Initial policy response." });
		await updateComment(env, activeUser, { postId: post.id, commentId: comment.id, body: "Updated policy response." });
		await archiveComment(env, siteAdmin, { postId: post.id, commentId: comment.id });
		const actions = await env.DB.prepare("SELECT action FROM audit_log WHERE entity_type = 'comment' ORDER BY created_at, rowid").all<{ action: string }>();
		expect(actions.results.map((entry) => entry.action)).toEqual(["comment.created", "comment.updated", "comment.archived"]);
		expect(await listPostComments(env, activeUser, post.id)).toEqual([]);
	});
});

describe("post interactions and notifications", () => {
	it("toggles one support per member and audits both states", async () => {
		await seedSiteAdmin();
		await seedUser();
		const post = await createPost(env, siteAdmin, {
			organizationId: null, section: "update", title: "A supported update", body: "Members can signal support for this published update.", visibility: "members", status: "published", tags: [],
		});
		await expect(togglePostSupport(env, activeUser, post.id)).resolves.toBe(true);
		await expect(getPostById(env, activeUser, post.id)).resolves.toMatchObject({ supportCount: 1, viewerSupported: true });
		await expect(togglePostSupport(env, activeUser, post.id)).resolves.toBe(false);
		await expect(getPostById(env, activeUser, post.id)).resolves.toMatchObject({ supportCount: 0, viewerSupported: false });
		const actions = await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'post.%supported' ORDER BY created_at, rowid").all<{ action: string }>();
		expect(actions.results.map((entry) => entry.action)).toEqual(["post.supported", "post.unsupported"]);
	});

	it("only offers mention targets who can see the post", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		await seedThirdMember();
		await seedOrganization();
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: activeUser.id, role: "contributor" });
		await setOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: secondMember.id, role: "viewer" });
		const post = await createPost(env, activeUser, {
			organizationId: "org-one", section: "project", title: "Internal mention test", body: "Only direct organization members can join this discussion.", visibility: "organization", status: "published", tags: [],
		});
		const mentionable = await listMentionableMembers(env, activeUser, post.id);
		expect(mentionable.map((member) => member.id)).toContain(secondMember.id);
		expect(mentionable.map((member) => member.id)).not.toContain(thirdMember.id);
		await expect(createComment(env, activeUser, { postId: post.id, parentCommentId: null, body: "A crafted invalid mention.", mentionUserId: thirdMember.id })).rejects.toMatchObject({ reason: "member-unavailable" });
		await createComment(env, activeUser, { postId: post.id, parentCommentId: null, body: "A valid internal mention.", mentionUserId: secondMember.id });
		expect(await countUnreadNotifications(env, secondMember)).toBe(1);
		await removeOrganizationMembership(env, siteAdmin, { organizationId: "org-one", userId: secondMember.id });
		expect(await countUnreadNotifications(env, secondMember)).toBe(0);
		expect(await listNotifications(env, secondMember)).toEqual([]);
	});

	it("creates deduplicated comment and mention notifications", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		const post = await createPost(env, siteAdmin, {
			organizationId: null, section: "legislation", title: "Notification test", body: "A policy conversation that generates relevant notifications.", visibility: "members", status: "published", tags: [],
		});
		const root = await createComment(env, activeUser, { postId: post.id, parentCommentId: null, body: "Mentioning a member in this policy thread.", mentionUserId: secondMember.id });
		expect(await countUnreadNotifications(env, secondMember)).toBe(1);
		expect(await listNotifications(env, secondMember)).toEqual([expect.objectContaining({ type: "mention", postId: post.id, commentId: root.id })]);
		expect(await countUnreadNotifications(env, siteAdmin)).toBe(1);

		await createComment(env, secondMember, { postId: post.id, parentCommentId: root.id, body: "Replying to the thread author.", mentionUserId: activeUser.id });
		const activeNotifications = await listNotifications(env, activeUser);
		expect(activeNotifications).toHaveLength(1);
		expect(activeNotifications[0]).toMatchObject({ type: "mention" });
		const mentionCount = await env.DB.prepare("SELECT count(*) AS count FROM post_mentions").first<number>("count");
		expect(mentionCount).toBe(2);
	});

	it("marks individual and all notifications read without changing another inbox", async () => {
		await seedSiteAdmin();
		await seedUser();
		await seedSecondMember();
		const post = await createPost(env, siteAdmin, {
			organizationId: null, section: "update", title: "Inbox controls", body: "A post used to validate notification read controls.", visibility: "members", status: "published", tags: [],
		});
		await createComment(env, activeUser, { postId: post.id, parentCommentId: null, body: "First notification for the author." });
		await createComment(env, secondMember, { postId: post.id, parentCommentId: null, body: "Second notification for the author." });
		const inbox = await listNotifications(env, siteAdmin);
		expect(inbox).toHaveLength(2);
		await markNotificationRead(env, siteAdmin.id, inbox[0]!.id);
		expect(await countUnreadNotifications(env, siteAdmin)).toBe(1);
		await markNotificationRead(env, activeUser.id, inbox[1]!.id);
		expect(await countUnreadNotifications(env, siteAdmin)).toBe(1);
		await markAllNotificationsRead(env, siteAdmin.id);
		expect(await countUnreadNotifications(env, siteAdmin)).toBe(0);
	});
});
