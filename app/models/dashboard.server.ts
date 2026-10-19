import type { AuthenticatedUser } from "../lib/auth.server";
import type { DatabaseSection } from "../lib/content";
import { eventDateTimeInputValue } from "../lib/events";
import { countUnreadNotifications } from "./notifications.server";

export type DashboardCounts = {
	activeMembers: number;
	organizations: number;
	pendingEvents: number;
	upcomingEvents: number;
};

export type DashboardPost = {
	id: string;
	section: DatabaseSection;
	title: string;
	body: string;
	organizationName: string | null;
	organizationSlug: string | null;
	organizationLogoObjectKey: string | null;
	thumbnailObjectKey: string | null;
	thumbnailUrl: string | null;
	createdAt: string;
	commentCount: number;
};

export type DashboardEvent = {
	postId: string;
	title: string;
	startsAt: string;
	locationName: string | null;
	organizationName: string | null;
	organizationSlug: string | null;
	organizationLogoObjectKey: string | null;
	thumbnailObjectKey: string | null;
	thumbnailUrl: string | null;
};

export type DashboardActivity = {
	commentId: string;
	postId: string;
	postTitle: string;
	authorName: string | null;
	thumbnailObjectKey: string | null;
	thumbnailUrl: string | null;
	createdAt: string;
};

export type DashboardAttentionItem = {
	id: "notifications" | "profile" | "organization" | "requests" | "event-review" | "membership-review" | "directory-review";
	title: string;
	detail: string;
	count: number | null;
	to: string;
	tone: "plum" | "blue" | "gold" | "green";
};

export type DashboardAffiliationActivity = DashboardPost & {
	affiliationNames: string;
};

export type DashboardData = {
	counts: DashboardCounts;
	recentPosts: DashboardPost[];
	affiliationActivity: DashboardAffiliationActivity[];
	upcomingEvents: DashboardEvent[];
	recentActivity: DashboardActivity[];
	attentionItems: DashboardAttentionItem[];
};

type DashboardAttentionCounts = {
	incompleteProfile: number;
	incompleteOrganizations: number;
	pendingOwnRequests: number;
	pendingMembershipReviews: number;
	pendingDirectoryReviews: number;
};

const viewerAffiliations = `effective_affiliations AS (
	SELECT user_id, affiliation_id FROM user_affiliations
	UNION
	SELECT membership.user_id, oa.affiliation_id
	FROM organization_memberships AS membership
	JOIN organizations AS member_organization
	  ON member_organization.id = membership.organization_id
	 AND member_organization.status != 'archived'
	JOIN organization_affiliations AS oa
	  ON oa.organization_id = membership.organization_id
), viewer_affiliations AS (
	SELECT affiliation_id FROM effective_affiliations WHERE user_id = ?1
)`;

const visiblePostPredicate = `(
	?2 = 1
	OR p.author_user_id = ?1
	OR EXISTS (
		SELECT 1 FROM organization_memberships
		WHERE organization_id = p.organization_id AND user_id = ?1 AND role = 'org_admin'
	)
	OR (p.visibility = 'organization' AND EXISTS (
		SELECT 1 FROM organization_memberships
		WHERE organization_id = p.organization_id AND user_id = ?1
	))
	OR (
		p.visibility = 'members'
		AND (p.organization_id IS NULL OR o.status = 'active')
		AND (EXISTS (
			SELECT 1
			FROM post_affiliations AS post_affiliation
			JOIN viewer_affiliations
			  ON viewer_affiliations.affiliation_id = post_affiliation.affiliation_id
			WHERE post_affiliation.post_id = p.id
		) OR NOT EXISTS (SELECT 1 FROM post_affiliations WHERE post_id = p.id))
	)
)`;

export async function getDashboardData(
	env: Env,
	viewer: AuthenticatedUser,
): Promise<DashboardData> {
	const isSiteAdmin = viewer.siteRole === "site_admin" ? 1 : 0;
	const now = eventDateTimeInputValue(new Date().toISOString());
	const [counts, attention, unreadNotifications, recentPosts, affiliationActivity, upcomingEvents, recentActivity] = await Promise.all([
		env.DB.prepare(
			`WITH ${viewerAffiliations}
			 SELECT
			   (SELECT count(*)
			    FROM users AS visible_member
			    WHERE visible_member.status = 'active'
			      AND visible_member.id != 'system:event-scraper'
			      AND (?2 = 1 OR visible_member.id = ?1 OR visible_member.profile_visibility = 'members')) AS activeMembers,
			   (SELECT count(*)
			    FROM organizations AS visible_organization
			    WHERE visible_organization.status = 'active') AS organizations,
			   (SELECT count(*)
			    FROM posts AS pending_post
			    JOIN events AS pending_event ON pending_event.post_id = pending_post.id
			    WHERE pending_post.section = 'event'
			      AND pending_post.status = 'draft'
			      AND pending_event.moderation_status = 'pending'
			      AND (?2 = 1 OR EXISTS (
			        SELECT 1 FROM organization_memberships
			        WHERE organization_id = pending_post.organization_id
			          AND user_id = ?1 AND role = 'org_admin'
			      ))) AS pendingEvents,
			   (SELECT count(*)
			    FROM posts AS p
			    JOIN events AS e ON e.post_id = p.id
			    LEFT JOIN organizations AS o ON o.id = p.organization_id
			    WHERE p.section = 'event'
			      AND p.status = 'published'
			      AND e.moderation_status = 'approved'
			      AND e.starts_at >= ?3
			      AND ${visiblePostPredicate}) AS upcomingEvents`,
		)
			.bind(viewer.id, isSiteAdmin, now)
			.first<DashboardCounts>(),
		env.DB.prepare(
			`SELECT
			   (SELECT count(*) FROM users WHERE id = ?1 AND profile_completed_at IS NULL) AS incompleteProfile,
			   (SELECT count(*)
			    FROM organization_memberships AS membership
			    JOIN organizations AS managed_organization ON managed_organization.id = membership.organization_id
			    WHERE membership.user_id = ?1 AND membership.role = 'org_admin'
			      AND managed_organization.status = 'active'
			      AND (managed_organization.summary IS NULL OR trim(managed_organization.summary) = ''
			        OR managed_organization.description IS NULL OR trim(managed_organization.description) = ''
			        OR managed_organization.website_url IS NULL OR trim(managed_organization.website_url) = ''
			        OR managed_organization.logo_object_key IS NULL)) AS incompleteOrganizations,
			   ((SELECT count(*) FROM organization_membership_claims WHERE user_id = ?1 AND status = 'pending')
			    + (SELECT count(*) FROM affiliation_membership_requests WHERE user_id = ?1 AND status = 'pending')) AS pendingOwnRequests,
			   (CASE WHEN ?2 = 1 THEN
			      (SELECT count(*) FROM organization_membership_claims WHERE status = 'pending')
			      + (SELECT count(*) FROM affiliation_membership_requests WHERE status = 'pending')
			    ELSE 0 END) AS pendingMembershipReviews,
			   (CASE WHEN ?2 = 1 THEN
			      (SELECT count(*) FROM organizations WHERE directory_status = 'pending')
			    ELSE 0 END) AS pendingDirectoryReviews`,
		).bind(viewer.id, isSiteAdmin).first<DashboardAttentionCounts>(),
		countUnreadNotifications(env, viewer),
		env.DB.prepare(
			`WITH ${viewerAffiliations}
			 SELECT p.id, p.section, p.title, p.body,
			        o.name AS organizationName,
			        o.slug AS organizationSlug,
			        o.logo_object_key AS organizationLogoObjectKey,
			        (SELECT attachment.object_key
			         FROM attachments AS attachment
			         WHERE attachment.post_id = p.id
			         ORDER BY attachment.created_at ASC, attachment.id ASC
			         LIMIT 1) AS thumbnailObjectKey,
			        CASE WHEN p.section = 'event' THEN e.image_url ELSE NULL END AS thumbnailUrl,
			        p.created_at AS createdAt,
			        (SELECT count(*) FROM comments
			         WHERE post_id = p.id AND status = 'published') AS commentCount
			 FROM posts AS p
			 LEFT JOIN organizations AS o ON o.id = p.organization_id
			 LEFT JOIN events AS e ON e.post_id = p.id
			 WHERE p.status = 'published'
			   AND (p.section != 'event' OR e.moderation_status = 'approved')
			   AND ${visiblePostPredicate}
			 ORDER BY p.created_at DESC, p.id DESC
			 LIMIT 3`,
		)
			.bind(viewer.id, isSiteAdmin)
			.all<DashboardPost>(),
		env.DB.prepare(
			`WITH ${viewerAffiliations}
			 SELECT p.id, p.section, p.title, p.body,
			        o.name AS organizationName,
			        o.slug AS organizationSlug,
			        o.logo_object_key AS organizationLogoObjectKey,
			        group_concat(DISTINCT a.name) AS affiliationNames,
			        (SELECT attachment.object_key
			         FROM attachments AS attachment
			         WHERE attachment.post_id = p.id
			         ORDER BY attachment.created_at ASC, attachment.id ASC
			         LIMIT 1) AS thumbnailObjectKey,
			        CASE WHEN p.section = 'event' THEN e.image_url ELSE NULL END AS thumbnailUrl,
			        p.created_at AS createdAt,
			        (SELECT count(*) FROM comments
			         WHERE post_id = p.id AND status = 'published') AS commentCount
			 FROM posts AS p
			 JOIN post_affiliations AS post_affiliation ON post_affiliation.post_id = p.id
			 JOIN affiliations AS a ON a.id = post_affiliation.affiliation_id
			 JOIN viewer_affiliations ON viewer_affiliations.affiliation_id = post_affiliation.affiliation_id
			 LEFT JOIN organizations AS o ON o.id = p.organization_id
			 LEFT JOIN events AS e ON e.post_id = p.id
			 WHERE p.status = 'published'
			   AND (p.section != 'event' OR e.moderation_status = 'approved')
			   AND ${visiblePostPredicate}
			 GROUP BY p.id
			 ORDER BY p.created_at DESC, p.id DESC
			 LIMIT 3`,
		).bind(viewer.id, isSiteAdmin).all<DashboardAffiliationActivity>(),
		env.DB.prepare(
			 `WITH ${viewerAffiliations}
			 SELECT p.id AS postId, p.title, e.starts_at AS startsAt,
			        e.location_name AS locationName,
			        o.name AS organizationName,
			        o.slug AS organizationSlug,
			        o.logo_object_key AS organizationLogoObjectKey,
			        (SELECT attachment.object_key
			         FROM attachments AS attachment
			         WHERE attachment.post_id = p.id
			         ORDER BY attachment.created_at ASC, attachment.id ASC
			         LIMIT 1) AS thumbnailObjectKey,
			        e.image_url AS thumbnailUrl
			 FROM posts AS p
			 JOIN events AS e ON e.post_id = p.id
			 LEFT JOIN organizations AS o ON o.id = p.organization_id
			 WHERE p.section = 'event'
			   AND p.status = 'published'
			   AND e.moderation_status = 'approved'
			   AND e.starts_at >= ?3
			   AND ${visiblePostPredicate}
			 ORDER BY e.starts_at ASC, p.id ASC
			 LIMIT 3`,
		)
			.bind(viewer.id, isSiteAdmin, now)
			.all<DashboardEvent>(),
		env.DB.prepare(
			 `WITH ${viewerAffiliations}
			 SELECT c.id AS commentId, c.post_id AS postId, p.title AS postTitle,
			        u.name AS authorName,
			        (SELECT attachment.object_key
			         FROM attachments AS attachment
			         WHERE attachment.post_id = p.id
			         ORDER BY attachment.created_at ASC, attachment.id ASC
			         LIMIT 1) AS thumbnailObjectKey,
			        CASE WHEN p.section = 'event' THEN e.image_url ELSE NULL END AS thumbnailUrl,
			        c.created_at AS createdAt
			 FROM comments AS c
			 JOIN posts AS p ON p.id = c.post_id
			 JOIN users AS u ON u.id = c.author_user_id
			 LEFT JOIN organizations AS o ON o.id = p.organization_id
			 LEFT JOIN events AS e ON e.post_id = p.id
			 WHERE c.status = 'published'
			   AND p.status = 'published'
			   AND c.author_user_id != ?1
			   AND (p.author_user_id = ?1 OR EXISTS (
			     SELECT 1 FROM comments AS parent_comment
			     WHERE parent_comment.id = c.parent_comment_id AND parent_comment.author_user_id = ?1
			   ))
			   AND (p.section != 'event' OR e.moderation_status = 'approved')
			   AND ${visiblePostPredicate}
			 ORDER BY c.created_at DESC, c.id DESC
			 LIMIT 3`,
		)
			.bind(viewer.id, isSiteAdmin)
			.all<DashboardActivity>(),
	]);
	const attentionCounts = attention ?? {
		incompleteProfile: 0,
		incompleteOrganizations: 0,
		pendingOwnRequests: 0,
		pendingMembershipReviews: 0,
		pendingDirectoryReviews: 0,
	};
	const attentionItems: DashboardAttentionItem[] = [];
	if (unreadNotifications > 0) attentionItems.push({ id: "notifications", title: "Unread notifications", detail: "Review new mentions, replies, support, and decisions.", count: unreadNotifications, to: "/notifications", tone: "plum" });
	if (attentionCounts.incompleteProfile > 0) attentionItems.push({ id: "profile", title: "Complete your profile", detail: "Add the details collaborators need to recognize and connect with you.", count: null, to: "/profile", tone: "gold" });
	if (attentionCounts.incompleteOrganizations > 0) attentionItems.push({ id: "organization", title: "Organization profiles need details", detail: "Add missing descriptions, websites, or logos to organizations you manage.", count: attentionCounts.incompleteOrganizations, to: "/organizations", tone: "blue" });
	if (attentionCounts.pendingOwnRequests > 0) attentionItems.push({ id: "requests", title: "Requests awaiting review", detail: "Track your pending organization claims and affiliation requests.", count: attentionCounts.pendingOwnRequests, to: "/profile", tone: "gold" });
	if ((counts?.pendingEvents ?? 0) > 0) attentionItems.push({ id: "event-review", title: "Events ready for review", detail: "Approve or return submitted events from organizations you moderate.", count: counts?.pendingEvents ?? 0, to: "/events/moderation", tone: "plum" });
	if (attentionCounts.pendingMembershipReviews > 0) attentionItems.push({ id: "membership-review", title: "Membership requests to review", detail: "Review organization claims and affiliation access requests.", count: attentionCounts.pendingMembershipReviews, to: "/admin", tone: "blue" });
	if (attentionCounts.pendingDirectoryReviews > 0) attentionItems.push({ id: "directory-review", title: "Directory requests to review", detail: "Organizations are waiting for public-directory approval.", count: attentionCounts.pendingDirectoryReviews, to: "/admin/organizations", tone: "green" });

	return {
		counts: counts ?? {
			activeMembers: 0,
			organizations: 0,
			pendingEvents: 0,
			upcomingEvents: 0,
		},
		recentPosts: recentPosts.results,
		affiliationActivity: affiliationActivity.results,
		upcomingEvents: upcomingEvents.results,
		recentActivity: recentActivity.results,
		attentionItems,
	};
}
