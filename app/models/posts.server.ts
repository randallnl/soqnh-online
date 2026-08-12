import type { AuthenticatedUser } from "../lib/auth.server";
import type {
	DatabaseSection,
	EditablePostStatus,
	PostVisibility,
} from "../lib/content";

const PAGE_SIZE = 10;

export type PostOrganizationOption = {
	id: string;
	name: string;
	slug: string;
	role: "contributor" | "org_admin" | null;
};

export type PostRecord = {
	id: string;
	organizationId: string | null;
	organizationName: string | null;
	organizationSlug: string | null;
	authorUserId: string;
	authorName: string | null;
	section: DatabaseSection;
	title: string;
	body: string;
	visibility: PostVisibility;
	status: "draft" | "published" | "archived";
	createdAt: string;
	updatedAt: string;
	commentCount: number;
	supportCount: number;
	viewerSupported: boolean;
	tags: string[];
	canEdit: boolean;
};

type PostRow = Omit<PostRecord, "tags" | "canEdit" | "viewerSupported"> & {
	tagList: string | null;
	canEdit: number;
	viewerSupported: number;
};

export class PostMutationError extends Error {
	constructor(
		public readonly reason:
			| "not-found"
			| "forbidden"
			| "organization-required"
			| "organization-unavailable",
	) {
		super(reason);
		this.name = "PostMutationError";
	}
}

function mapPost(row: PostRow): PostRecord {
	return {
		...row,
		tags: row.tagList ? row.tagList.split(",") : [],
		canEdit: row.canEdit === 1,
		viewerSupported: row.viewerSupported === 1,
	};
}

export async function listPostOrganizations(env: Env, actor: AuthenticatedUser) {
	const result = await env.DB.prepare(
		`SELECT o.id, o.name, o.slug,
		        CASE WHEN ?2 = 1 THEN NULL ELSE om.role END AS role
		 FROM organizations AS o
		 LEFT JOIN organization_memberships AS om
		   ON om.organization_id = o.id AND om.user_id = ?1
		 WHERE o.status = 'active'
		   AND (?2 = 1 OR om.role IN ('contributor', 'org_admin'))
		 ORDER BY o.name COLLATE NOCASE`,
	)
		.bind(actor.id, actor.siteRole === "site_admin" ? 1 : 0)
		.all<PostOrganizationOption>();
	return result.results;
}

async function requirePostOrganization(
	env: Env,
	actor: AuthenticatedUser,
	organizationId: string | null,
) {
	if (!organizationId) {
		if (actor.siteRole !== "site_admin") {
			throw new PostMutationError("organization-required");
		}
		return;
	}
	const available = await env.DB.prepare(
		`SELECT 1
		 FROM organizations AS o
		 LEFT JOIN organization_memberships AS om
		   ON om.organization_id = o.id AND om.user_id = ?1
		 WHERE o.id = ?2 AND o.status = 'active'
		   AND (?3 = 1 OR om.role IN ('contributor', 'org_admin'))`,
	)
		.bind(actor.id, organizationId, actor.siteRole === "site_admin" ? 1 : 0)
		.first<number>("1");
	if (available === null) throw new PostMutationError("organization-unavailable");
}

export async function listSectionPosts(
	env: Env,
	viewer: AuthenticatedUser,
	input: {
		section: DatabaseSection;
		tag: string | null;
		organizationId: string | null;
		page: number;
	},
) {
	const offset = (input.page - 1) * PAGE_SIZE;
	const viewerCte = `viewer_affiliations AS (
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
	const visibleFrom = `FROM posts AS p
		 LEFT JOIN organizations AS o ON o.id = p.organization_id
		 WHERE p.section = ?2
		   AND p.status = 'published'
		   AND (?3 IS NULL OR p.organization_id = ?3)
		   AND (?4 IS NULL OR EXISTS (
		     SELECT 1 FROM post_tags WHERE post_id = p.id AND tag = ?4
		   ))
		   AND (
		     ?5 = 1
		     OR p.organization_id IS NULL
		     OR EXISTS (
		       SELECT 1 FROM organization_memberships
		       WHERE organization_id = p.organization_id AND user_id = ?1
		     )
		     OR (
		       p.visibility = 'members'
		       AND o.status = 'active'
		       AND EXISTS (
		         SELECT 1 FROM organization_affiliations AS organization_affiliation
		         JOIN viewer_affiliations
		           ON viewer_affiliations.affiliation_id = organization_affiliation.affiliation_id
		         WHERE organization_affiliation.organization_id = p.organization_id
		       )
		     )
		   )`;

	const bindings = [
		viewer.id,
		input.section,
		input.organizationId,
		input.tag,
		viewer.siteRole === "site_admin" ? 1 : 0,
	] as const;
	const [postResult, countResult, tagResult] = await Promise.all([
		env.DB.prepare(
			`WITH viewer_affiliations AS (
			   SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
			   UNION
			   SELECT oa.affiliation_id
			   FROM organization_memberships AS membership
			   JOIN organizations AS member_organization
			     ON member_organization.id = membership.organization_id
			    AND member_organization.status != 'archived'
			   JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
			   WHERE membership.user_id = ?1
			 )
			 SELECT p.id, p.organization_id AS organizationId,
			        o.name AS organizationName, o.slug AS organizationSlug,
			        p.author_user_id AS authorUserId, u.name AS authorName,
			        p.section, p.title, p.body, p.visibility, p.status,
			        p.created_at AS createdAt, p.updated_at AS updatedAt,
			        (SELECT count(*) FROM comments WHERE post_id = p.id AND status = 'published') AS commentCount,
			        (SELECT count(*) FROM post_reactions WHERE post_id = p.id AND reaction = 'support') AS supportCount,
			        EXISTS (SELECT 1 FROM post_reactions WHERE post_id = p.id AND user_id = ?1 AND reaction = 'support') AS viewerSupported,
			        (SELECT group_concat(tag, ',') FROM (SELECT tag FROM post_tags WHERE post_id = p.id ORDER BY tag)) AS tagList,
			        CASE WHEN ?5 = 1 OR EXISTS (
			          SELECT 1 FROM organization_memberships
			          WHERE organization_id = p.organization_id AND user_id = ?1 AND role = 'org_admin'
			        ) OR (p.author_user_id = ?1 AND EXISTS (
			          SELECT 1 FROM organization_memberships
			          WHERE organization_id = p.organization_id AND user_id = ?1 AND role IN ('contributor', 'org_admin')
			        )) THEN 1 ELSE 0 END AS canEdit
			 FROM posts AS p
			 JOIN users AS u ON u.id = p.author_user_id
			 LEFT JOIN organizations AS o ON o.id = p.organization_id
			 WHERE p.section = ?2 AND p.status = 'published'
			   AND (?3 IS NULL OR p.organization_id = ?3)
			   AND (?4 IS NULL OR EXISTS (SELECT 1 FROM post_tags WHERE post_id = p.id AND tag = ?4))
			   AND (
			     ?5 = 1 OR p.organization_id IS NULL
			     OR EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = p.organization_id AND user_id = ?1)
			     OR (p.visibility = 'members' AND o.status = 'active' AND EXISTS (
			       SELECT 1 FROM organization_affiliations AS organization_affiliation
			       JOIN viewer_affiliations ON viewer_affiliations.affiliation_id = organization_affiliation.affiliation_id
			       WHERE organization_affiliation.organization_id = p.organization_id
			     ))
			   )
			 ORDER BY p.created_at DESC, p.id DESC
			 LIMIT ?6 OFFSET ?7`,
		)
			.bind(...bindings, PAGE_SIZE, offset)
			.all<PostRow>(),
		env.DB.prepare(`WITH ${viewerCte}, visible_posts AS (SELECT p.id ${visibleFrom}) SELECT count(*) AS count FROM visible_posts`)
			.bind(...bindings)
			.first<number>("count"),
		env.DB.prepare(`WITH ${viewerCte}, visible_posts AS (SELECT p.id ${visibleFrom}) SELECT pt.tag, count(*) AS count FROM post_tags AS pt JOIN visible_posts ON visible_posts.id = pt.post_id GROUP BY pt.tag ORDER BY count DESC, pt.tag LIMIT 20`)
			.bind(...bindings)
			.all<{ tag: string; count: number }>(),
	]);

	const total = countResult ?? 0;
	return {
		posts: postResult.results.map(mapPost),
		tags: tagResult.results,
		page: input.page,
		total,
		totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
	};
}

export async function getPostById(env: Env, viewer: AuthenticatedUser, postId: string) {
	const row = await env.DB.prepare(
		`WITH viewer_affiliations AS (
		   SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
		   UNION
		   SELECT oa.affiliation_id
		   FROM organization_memberships AS membership
		   JOIN organizations AS member_organization
		     ON member_organization.id = membership.organization_id AND member_organization.status != 'archived'
		   JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
		   WHERE membership.user_id = ?1
		 )
		 SELECT p.id, p.organization_id AS organizationId,
		        o.name AS organizationName, o.slug AS organizationSlug,
		        p.author_user_id AS authorUserId, u.name AS authorName,
		        p.section, p.title, p.body, p.visibility, p.status,
		        p.created_at AS createdAt, p.updated_at AS updatedAt,
		        (SELECT count(*) FROM comments WHERE post_id = p.id AND status = 'published') AS commentCount,
		        (SELECT count(*) FROM post_reactions WHERE post_id = p.id AND reaction = 'support') AS supportCount,
		        EXISTS (SELECT 1 FROM post_reactions WHERE post_id = p.id AND user_id = ?1 AND reaction = 'support') AS viewerSupported,
		        (SELECT group_concat(tag, ',') FROM (SELECT tag FROM post_tags WHERE post_id = p.id ORDER BY tag)) AS tagList,
		        CASE WHEN ?3 = 1 OR EXISTS (
		          SELECT 1 FROM organization_memberships
		          WHERE organization_id = p.organization_id AND user_id = ?1 AND role = 'org_admin'
		        ) OR (p.author_user_id = ?1 AND EXISTS (
		          SELECT 1 FROM organization_memberships
		          WHERE organization_id = p.organization_id AND user_id = ?1 AND role IN ('contributor', 'org_admin')
		        )) THEN 1 ELSE 0 END AS canEdit
		 FROM posts AS p
		 JOIN users AS u ON u.id = p.author_user_id
		 LEFT JOIN organizations AS o ON o.id = p.organization_id
		 WHERE p.id = ?2
		   AND (
		     ?3 = 1
		     OR p.author_user_id = ?1
		     OR EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = p.organization_id AND user_id = ?1 AND role = 'org_admin')
		     OR (p.status = 'published' AND p.organization_id IS NULL)
		     OR (p.status = 'published' AND EXISTS (
		       SELECT 1 FROM organization_memberships WHERE organization_id = p.organization_id AND user_id = ?1
		     ))
		     OR (p.status = 'published' AND p.visibility = 'members' AND o.status = 'active' AND EXISTS (
		       SELECT 1 FROM organization_affiliations AS organization_affiliation
		       JOIN viewer_affiliations ON viewer_affiliations.affiliation_id = organization_affiliation.affiliation_id
		       WHERE organization_affiliation.organization_id = p.organization_id
		     ))
		   )
		 LIMIT 1`,
	)
		.bind(viewer.id, postId, viewer.siteRole === "site_admin" ? 1 : 0)
		.first<PostRow>();
	return row ? mapPost(row) : null;
}

export async function createPost(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		organizationId: string | null;
		section: DatabaseSection;
		title: string;
		body: string;
		visibility: PostVisibility;
		status: EditablePostStatus;
		tags: string[];
	},
) {
	await requirePostOrganization(env, actor, input.organizationId);
	if (input.visibility === "organization" && !input.organizationId) {
		throw new PostMutationError("organization-required");
	}
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO posts
			 (id, organization_id, author_user_id, section, title, body, visibility, status, created_at, updated_at, archived_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL)`,
		).bind(id, input.organizationId, actor.id, input.section, input.title, input.body, input.visibility, input.status, now),
		...input.tags.map((tag) => env.DB.prepare("INSERT INTO post_tags (post_id, tag) VALUES (?1, ?2)").bind(id, tag)),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'post.created', 'post', ?3, ?4, ?5)`,
		).bind(crypto.randomUUID(), actor.id, id, JSON.stringify({ section: input.section, status: input.status, visibility: input.visibility, organizationId: input.organizationId }), now),
	]);
	return { id };
}

export async function updatePost(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		postId: string;
		organizationId: string | null;
		title: string;
		body: string;
		visibility: PostVisibility;
		status: EditablePostStatus;
		tags: string[];
	},
) {
	const existing = await getPostById(env, actor, input.postId);
	if (!existing) throw new PostMutationError("not-found");
	if (!existing.canEdit) throw new PostMutationError("forbidden");
	await requirePostOrganization(env, actor, input.organizationId);
	if (input.visibility === "organization" && !input.organizationId) {
		throw new PostMutationError("organization-required");
	}
	const now = new Date().toISOString();
	const statements = [
		env.DB.prepare(
			`UPDATE posts SET organization_id = ?1, title = ?2, body = ?3,
			 visibility = ?4, status = ?5, updated_at = ?6, archived_at = NULL
			 WHERE id = ?7`,
		).bind(input.organizationId, input.title, input.body, input.visibility, input.status, now, input.postId),
		env.DB.prepare("DELETE FROM post_tags WHERE post_id = ?1").bind(input.postId),
		...input.tags.map((tag) => env.DB.prepare("INSERT INTO post_tags (post_id, tag) VALUES (?1, ?2)").bind(input.postId, tag)),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'post.updated', 'post', ?3, ?4, ?5)`,
		).bind(crypto.randomUUID(), actor.id, input.postId, JSON.stringify({ status: input.status, visibility: input.visibility, organizationId: input.organizationId }), now),
	];
	await env.DB.batch(statements);
}

export async function archivePost(env: Env, actor: AuthenticatedUser, postId: string) {
	const existing = await getPostById(env, actor, postId);
	if (!existing) throw new PostMutationError("not-found");
	if (!existing.canEdit) throw new PostMutationError("forbidden");
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE posts SET status = 'archived', archived_at = ?1, updated_at = ?1 WHERE id = ?2`,
		).bind(now, postId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'post.archived', 'post', ?3, NULL, ?4)`,
		).bind(crypto.randomUUID(), actor.id, postId, now),
	]);
	if (results[0]?.meta.changes !== 1) throw new PostMutationError("not-found");
}
