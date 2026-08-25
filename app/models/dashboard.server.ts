import type { AuthenticatedUser } from "../lib/auth.server";
import type { DatabaseSection } from "../lib/content";
import { eventDateTimeInputValue } from "../lib/events";

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
	createdAt: string;
	commentCount: number;
};

export type DashboardEvent = {
	postId: string;
	title: string;
	startsAt: string;
	locationName: string | null;
};

export type DashboardActivity = {
	commentId: string;
	postId: string;
	postTitle: string;
	authorName: string | null;
	createdAt: string;
};

export type DashboardData = {
	counts: DashboardCounts;
	recentPosts: DashboardPost[];
	upcomingEvents: DashboardEvent[];
	recentActivity: DashboardActivity[];
};

const viewerAffiliations = `viewer_affiliations AS (
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
)`;

const visiblePostPredicate = `(
	?2 = 1
	OR p.organization_id IS NULL
	OR EXISTS (
		SELECT 1 FROM organization_memberships
		WHERE organization_id = p.organization_id AND user_id = ?1
	)
	OR (
		p.visibility = 'members'
		AND o.status = 'active'
		AND EXISTS (
			SELECT 1
			FROM organization_affiliations AS organization_affiliation
			JOIN viewer_affiliations
			  ON viewer_affiliations.affiliation_id = organization_affiliation.affiliation_id
			WHERE organization_affiliation.organization_id = p.organization_id
		)
	)
)`;

export async function getDashboardData(
	env: Env,
	viewer: AuthenticatedUser,
): Promise<DashboardData> {
	const isSiteAdmin = viewer.siteRole === "site_admin" ? 1 : 0;
	const now = eventDateTimeInputValue(new Date().toISOString());
	const [counts, recentPosts, upcomingEvents, recentActivity] = await Promise.all([
		env.DB.prepare(
			`WITH ${viewerAffiliations}
			 SELECT
			   (SELECT count(*) FROM users WHERE status = 'active') AS activeMembers,
			   (SELECT count(*) FROM organizations WHERE status = 'active') AS organizations,
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
			`WITH ${viewerAffiliations}
			 SELECT p.id, p.section, p.title, p.body,
			        o.name AS organizationName, p.created_at AS createdAt,
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
			 SELECT p.id AS postId, p.title, e.starts_at AS startsAt,
			        e.location_name AS locationName
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
			        u.name AS authorName, c.created_at AS createdAt
			 FROM comments AS c
			 JOIN posts AS p ON p.id = c.post_id
			 JOIN users AS u ON u.id = c.author_user_id
			 LEFT JOIN organizations AS o ON o.id = p.organization_id
			 LEFT JOIN events AS e ON e.post_id = p.id
			 WHERE c.status = 'published'
			   AND p.status = 'published'
			   AND (p.section != 'event' OR e.moderation_status = 'approved')
			   AND ${visiblePostPredicate}
			 ORDER BY c.created_at DESC, c.id DESC
			 LIMIT 3`,
		)
			.bind(viewer.id, isSiteAdmin)
			.all<DashboardActivity>(),
	]);

	return {
		counts: counts ?? {
			activeMembers: 0,
			organizations: 0,
			pendingEvents: 0,
			upcomingEvents: 0,
		},
		recentPosts: recentPosts.results,
		upcomingEvents: upcomingEvents.results,
		recentActivity: recentActivity.results,
	};
}
