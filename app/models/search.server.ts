import type { AuthenticatedUser } from "../lib/auth.server";

const RESULT_LIMIT = 8;

export type SearchOrganizationResult = {
	id: string;
	name: string;
	slug: string;
	summary: string | null;
	category: string | null;
	townCity: string | null;
	region: string | null;
	logoObjectKey: string | null;
};

export type SearchMemberResult = {
	id: string;
	name: string | null;
	profileTitle: string | null;
	bio: string | null;
	location: string | null;
	avatarObjectKey: string | null;
	organizationNames: string | null;
};

export type SearchContentResult = {
	id: string;
	section: "event" | "project" | "update";
	title: string;
	body: string;
	createdAt: string;
	organizationName: string | null;
	organizationSlug: string | null;
	organizationLogoObjectKey: string | null;
	eventStartsAt: string | null;
	eventLocationName: string | null;
	thumbnailObjectKey: string | null;
	thumbnailUrl: string | null;
};

export type WorkspaceSearchResults = {
	organizations: SearchOrganizationResult[];
	members: SearchMemberResult[];
	events: SearchContentResult[];
	projects: SearchContentResult[];
	updates: SearchContentResult[];
};

const emptyResults = (): WorkspaceSearchResults => ({
	organizations: [],
	members: [],
	events: [],
	projects: [],
	updates: [],
});

const viewerAffiliations = `viewer_affiliations AS (
	SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
	UNION
	SELECT oa.affiliation_id
	FROM organization_memberships AS membership
	JOIN organizations AS member_organization
	  ON member_organization.id = membership.organization_id
	 AND member_organization.status != 'archived'
	JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
	WHERE membership.user_id = ?1
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

function escapedLikeValue(value: string) {
	return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function contentStatement(env: Env, section: SearchContentResult["section"]) {
	return env.DB.prepare(
		`WITH ${viewerAffiliations}
		 SELECT p.id, p.section, p.title, p.body, p.created_at AS createdAt,
		        o.name AS organizationName, o.slug AS organizationSlug,
		        o.logo_object_key AS organizationLogoObjectKey,
		        e.starts_at AS eventStartsAt, e.location_name AS eventLocationName,
		        (SELECT attachment.object_key
		         FROM attachments AS attachment
		         WHERE attachment.post_id = p.id
		           AND attachment.content_type LIKE 'image/%'
		         ORDER BY attachment.created_at, attachment.id LIMIT 1) AS thumbnailObjectKey,
		        e.image_url AS thumbnailUrl
		 FROM posts AS p
		 LEFT JOIN organizations AS o ON o.id = p.organization_id
		 LEFT JOIN events AS e ON e.post_id = p.id
		 WHERE p.section = ?3
		   AND p.status = 'published'
		   AND (?3 != 'event' OR e.moderation_status = 'approved')
		   AND ${visiblePostPredicate}
		   AND (
		     lower(p.title) LIKE ?5 ESCAPE '\\'
		     OR lower(p.body) LIKE ?5 ESCAPE '\\'
		     OR lower(coalesce(o.name, '')) LIKE ?5 ESCAPE '\\'
		     OR lower(coalesce(e.location_name, '')) LIKE ?5 ESCAPE '\\'
		     OR EXISTS (
		       SELECT 1 FROM post_tags AS search_tag
		       WHERE search_tag.post_id = p.id
		         AND lower(search_tag.tag) LIKE ?5 ESCAPE '\\'
		     )
		   )
		 ORDER BY CASE
		   WHEN lower(p.title) = ?4 THEN 0
		   WHEN lower(p.title) LIKE ?6 ESCAPE '\\' THEN 1
		   WHEN lower(coalesce(o.name, '')) LIKE ?6 ESCAPE '\\' THEN 2
		   ELSE 3 END,
		   CASE WHEN p.section = 'event' THEN e.starts_at END,
		   p.created_at DESC
		 LIMIT ${RESULT_LIMIT}`,
	);
}

export async function searchWorkspace(
	env: Env,
	viewer: AuthenticatedUser,
	query: string,
): Promise<WorkspaceSearchResults> {
	const normalized = query.trim().toLocaleLowerCase().slice(0, 100);
	if (normalized.length < 2) return emptyResults();
	const escaped = escapedLikeValue(normalized);
	const contains = `%${escaped}%`;
	const prefix = `${escaped}%`;
	const isSiteAdmin = viewer.siteRole === "site_admin" ? 1 : 0;

	const [organizations, members, events, projects, updates] = await Promise.all([
		env.DB.prepare(
			`SELECT o.id, o.name, o.slug, o.summary, o.category,
			        o.town_city AS townCity, o.region, o.logo_object_key AS logoObjectKey
			 FROM organizations AS o
			 WHERE o.status = 'active'
			   AND (
			     lower(o.name) LIKE ?2 ESCAPE '\\'
			     OR lower(coalesce(o.summary, '')) LIKE ?2 ESCAPE '\\'
			     OR lower(coalesce(o.description, '')) LIKE ?2 ESCAPE '\\'
			     OR lower(coalesce(o.category, '')) LIKE ?2 ESCAPE '\\'
			     OR lower(coalesce(o.town_city, '')) LIKE ?2 ESCAPE '\\'
			     OR lower(coalesce(o.region, '')) LIKE ?2 ESCAPE '\\'
			   )
			 ORDER BY CASE
			   WHEN lower(o.name) = ?1 THEN 0
			   WHEN lower(o.name) LIKE ?3 ESCAPE '\\' THEN 1
			   ELSE 2 END,
			   o.name COLLATE NOCASE
			 LIMIT ${RESULT_LIMIT}`,
		).bind(normalized, contains, prefix).all<SearchOrganizationResult>(),
		env.DB.prepare(
			`SELECT u.id, u.name, u.profile_title AS profileTitle, u.bio, u.location,
			        u.avatar_object_key AS avatarObjectKey,
			        (SELECT group_concat(name, ', ') FROM (
			          SELECT DISTINCT member_organization.name AS name
			          FROM organization_memberships AS membership
			          JOIN organizations AS member_organization ON member_organization.id = membership.organization_id
			          WHERE membership.user_id = u.id AND member_organization.status != 'archived'
			          ORDER BY member_organization.name COLLATE NOCASE
			        )) AS organizationNames
			 FROM users AS u
			 WHERE u.status = 'active'
			   AND u.id != 'system:event-scraper'
			   AND (?2 = 1 OR u.id = ?1 OR u.profile_visibility = 'members')
			   AND (
			     lower(coalesce(u.name, '')) LIKE ?4 ESCAPE '\\'
			     OR lower(coalesce(u.profile_title, '')) LIKE ?4 ESCAPE '\\'
			     OR lower(coalesce(u.bio, '')) LIKE ?4 ESCAPE '\\'
			     OR lower(coalesce(u.location, '')) LIKE ?4 ESCAPE '\\'
			     OR EXISTS (
			       SELECT 1 FROM organization_memberships AS search_membership
			       JOIN organizations AS search_organization ON search_organization.id = search_membership.organization_id
			       WHERE search_membership.user_id = u.id
			         AND search_organization.status != 'archived'
			         AND lower(search_organization.name) LIKE ?4 ESCAPE '\\'
			     )
			   )
			 ORDER BY CASE
			   WHEN lower(coalesce(u.name, '')) = ?3 THEN 0
			   WHEN lower(coalesce(u.name, '')) LIKE ?5 ESCAPE '\\' THEN 1
			   ELSE 2 END,
			   coalesce(u.name, u.email) COLLATE NOCASE
			 LIMIT ${RESULT_LIMIT}`,
		).bind(viewer.id, isSiteAdmin, normalized, contains, prefix).all<SearchMemberResult>(),
		contentStatement(env, "event").bind(viewer.id, isSiteAdmin, "event", normalized, contains, prefix).all<SearchContentResult>(),
		contentStatement(env, "project").bind(viewer.id, isSiteAdmin, "project", normalized, contains, prefix).all<SearchContentResult>(),
		contentStatement(env, "update").bind(viewer.id, isSiteAdmin, "update", normalized, contains, prefix).all<SearchContentResult>(),
	]);

	return {
		organizations: organizations.results,
		members: members.results,
		events: events.results,
		projects: projects.results,
		updates: updates.results,
	};
}
