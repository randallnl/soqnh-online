import type { AuthenticatedUser } from "../lib/auth.server";
import { getPostById } from "./posts.server";
import { getMentionRecipient } from "./interactions.server";

export type CommentRecord = {
	id: string;
	postId: string;
	parentCommentId: string | null;
	authorUserId: string;
	authorName: string | null;
	body: string | null;
	status: "published" | "archived";
	createdAt: string;
	updatedAt: string;
	mentionedUserId: string | null;
	mentionedUserName: string | null;
	canEdit: boolean;
	canDelete: boolean;
	replies: CommentRecord[];
};

type CommentRow = Omit<CommentRecord, "canEdit" | "canDelete" | "replies"> & {
	canEdit: number;
	canDelete: number;
};

export class CommentMutationError extends Error {
	constructor(public readonly reason: "not-found" | "forbidden" | "post-unavailable" | "invalid-parent") {
		super(reason);
		this.name = "CommentMutationError";
	}
}

async function requirePublishedPost(env: Env, actor: AuthenticatedUser, postId: string) {
	const post = await getPostById(env, actor, postId);
	if (!post || post.status !== "published") throw new CommentMutationError("post-unavailable");
	return post;
}

export async function listPostComments(env: Env, viewer: AuthenticatedUser, postId: string) {
	const post = await getPostById(env, viewer, postId);
	if (!post) throw new CommentMutationError("post-unavailable");
	const result = await env.DB.prepare(
		`SELECT c.id, c.post_id AS postId, c.parent_comment_id AS parentCommentId,
		        c.author_user_id AS authorUserId, u.name AS authorName,
		        CASE WHEN c.status = 'archived' THEN NULL ELSE c.body END AS body, c.status,
		        c.created_at AS createdAt, c.updated_at AS updatedAt,
		        CASE WHEN c.status = 'published' THEN (SELECT mentioned.id FROM post_mentions JOIN users AS mentioned ON mentioned.id = post_mentions.mentioned_user_id WHERE post_mentions.comment_id = c.id AND (?3 = 1 OR mentioned.id = ?1 OR mentioned.profile_visibility != 'hidden') LIMIT 1) END AS mentionedUserId,
		        CASE WHEN c.status = 'published' THEN (SELECT coalesce(mentioned.name, 'Member') FROM post_mentions JOIN users AS mentioned ON mentioned.id = post_mentions.mentioned_user_id WHERE post_mentions.comment_id = c.id AND (?3 = 1 OR mentioned.id = ?1 OR mentioned.profile_visibility != 'hidden') LIMIT 1) END AS mentionedUserName,
		        CASE WHEN c.status = 'published' AND c.author_user_id = ?1 THEN 1 ELSE 0 END AS canEdit,
		        CASE WHEN c.status = 'published' AND (
		          c.author_user_id = ?1 OR ?3 = 1 OR EXISTS (
		            SELECT 1 FROM organization_memberships
		            WHERE organization_id = p.organization_id AND user_id = ?1 AND role = 'org_admin'
		          )
		        ) THEN 1 ELSE 0 END AS canDelete
		 FROM comments AS c
		 JOIN users AS u ON u.id = c.author_user_id
		 JOIN posts AS p ON p.id = c.post_id
		 WHERE c.post_id = ?2 AND c.status IN ('published', 'archived')
		 ORDER BY c.created_at, c.id`,
	)
		.bind(viewer.id, postId, viewer.siteRole === "site_admin" ? 1 : 0)
		.all<CommentRow>();

	const publishedParentIds = new Set(result.results.flatMap((row) => row.status === "published" && row.parentCommentId ? [row.parentCommentId] : []));
	const visibleRows = result.results.filter((row) => row.status === "published" || (
		row.parentCommentId === null
		&& publishedParentIds.has(row.id)
	));
	const comments = visibleRows.map<CommentRecord>((row) => ({
		...row,
		canEdit: row.canEdit === 1,
		canDelete: row.canDelete === 1,
		replies: [],
	}));
	const byId = new Map(comments.map((comment) => [comment.id, comment]));
	const roots: CommentRecord[] = [];
	for (const comment of comments) {
		const parent = comment.parentCommentId ? byId.get(comment.parentCommentId) : null;
		if (parent) parent.replies.push(comment);
		else roots.push(comment);
	}
	return roots;
}

export async function createComment(
	env: Env,
	actor: AuthenticatedUser,
	input: { postId: string; parentCommentId: string | null; body: string; mentionUserId?: string | null },
) {
	const post = await requirePublishedPost(env, actor, input.postId);
	let parentAuthorUserId: string | null = null;
	if (input.parentCommentId) {
		const parent = await env.DB.prepare(
			`SELECT parent_comment_id AS parentCommentId, author_user_id AS authorUserId
			 FROM comments
			 WHERE id = ?1 AND post_id = ?2 AND status = 'published'`,
		)
			.bind(input.parentCommentId, input.postId)
			.first<{ parentCommentId: string | null; authorUserId: string }>();
		if (!parent || parent.parentCommentId) throw new CommentMutationError("invalid-parent");
		parentAuthorUserId = parent.authorUserId;
	}
	const mentioned = input.mentionUserId ? await getMentionRecipient(env, actor, input.postId, input.mentionUserId) : null;
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	const actorName = actor.name || "A member";
	const commentRecipients = new Set([post.authorUserId, parentAuthorUserId].filter((userId): userId is string => Boolean(userId) && userId !== actor.id && userId !== mentioned?.id));
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO comments
			 (id, post_id, parent_comment_id, author_user_id, body, status, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, 'published', ?6, ?6)`,
		).bind(id, input.postId, input.parentCommentId, actor.id, input.body, now),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'comment.created', 'comment', ?3, ?4, ?5)`,
		).bind(crypto.randomUUID(), actor.id, id, JSON.stringify({ postId: input.postId, parentCommentId: input.parentCommentId }), now),
		...(mentioned ? [
			env.DB.prepare(
				`INSERT INTO post_mentions
				 (id, post_id, comment_id, mentioned_user_id, mentioned_by_user_id, created_at)
				 VALUES (?1, NULL, ?2, ?3, ?4, ?5)`,
			).bind(crypto.randomUUID(), id, mentioned.id, actor.id, now),
			env.DB.prepare(
				`INSERT INTO notifications
				 (id, user_id, actor_user_id, post_id, comment_id, type, body, read_at, created_at)
				 VALUES (?1, ?2, ?3, ?4, ?5, 'mention', ?6, NULL, ?7)`,
			).bind(crypto.randomUUID(), mentioned.id, actor.id, input.postId, id, `${actorName} mentioned you in a comment.`, now),
		] : []),
		...[...commentRecipients].map((userId) => env.DB.prepare(
			`INSERT INTO notifications
			 (id, user_id, actor_user_id, post_id, comment_id, type, body, read_at, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, 'comment', ?6, NULL, ?7)`,
		).bind(crypto.randomUUID(), userId, actor.id, input.postId, id, input.parentCommentId ? `${actorName} replied in a conversation you follow.` : `${actorName} commented on your post.`, now)),
	]);
	return { id };
}

export async function updateComment(
	env: Env,
	actor: AuthenticatedUser,
	input: { postId: string; commentId: string; body: string },
) {
	await requirePublishedPost(env, actor, input.postId);
	const editable = await env.DB.prepare(
		`SELECT 1 FROM comments
		 WHERE id = ?1 AND post_id = ?2 AND author_user_id = ?3 AND status = 'published'`,
	).bind(input.commentId, input.postId, actor.id).first<number>("1");
	if (editable === null) throw new CommentMutationError("forbidden");
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			`UPDATE comments SET body = ?1, updated_at = ?2
			 WHERE id = ?3`,
		).bind(input.body, now, input.commentId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'comment.updated', 'comment', ?3, ?4, ?5)`,
		).bind(crypto.randomUUID(), actor.id, input.commentId, JSON.stringify({ postId: input.postId }), now),
	]);
}

export async function archiveComment(
	env: Env,
	actor: AuthenticatedUser,
	input: { postId: string; commentId: string },
) {
	const post = await requirePublishedPost(env, actor, input.postId);
	const canModerateOrganization = post.organizationId
		? await env.DB.prepare(
			`SELECT 1 FROM organization_memberships
			 WHERE organization_id = ?1 AND user_id = ?2 AND role = 'org_admin'`,
		).bind(post.organizationId, actor.id).first<number>("1")
		: null;
	const removable = await env.DB.prepare(
		`SELECT author_user_id AS authorUserId
		 FROM comments WHERE id = ?1 AND post_id = ?2 AND status = 'published'`,
	).bind(input.commentId, input.postId).first<{ authorUserId: string }>();
	if (!removable) throw new CommentMutationError("not-found");
	if (removable.authorUserId !== actor.id && actor.siteRole !== "site_admin" && canModerateOrganization === null) {
		throw new CommentMutationError("forbidden");
	}
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			`UPDATE comments SET status = 'archived', updated_at = ?1
			 WHERE id = ?2`,
		).bind(now, input.commentId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'comment.archived', 'comment', ?3, ?4, ?5)`,
		).bind(crypto.randomUUID(), actor.id, input.commentId, JSON.stringify({ postId: input.postId }), now),
	]);
}
