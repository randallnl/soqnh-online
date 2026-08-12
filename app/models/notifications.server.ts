import type { AuthenticatedUser } from "../lib/auth.server";

export type NotificationRecord = {
	id: string;
	actorName: string | null;
	postId: string | null;
	commentId: string | null;
	type: "comment" | "mention" | "approval";
	body: string;
	readAt: string | null;
	createdAt: string;
};

const viewerAffiliationsCte = `viewer_affiliations AS (
  SELECT affiliation_id FROM user_affiliations WHERE user_id = ?1
  UNION
  SELECT oa.affiliation_id
  FROM organization_memberships AS membership
  JOIN organizations AS member_organization
    ON member_organization.id = membership.organization_id AND member_organization.status != 'archived'
  JOIN organization_affiliations AS oa ON oa.organization_id = membership.organization_id
  WHERE membership.user_id = ?1
)`;

const visibleNotificationWhere = `n.user_id = ?1
  AND (n.post_id IS NULL OR ?2 = 1 OR p.author_user_id = ?1
    OR (p.status = 'published' AND p.organization_id IS NULL)
    OR (p.status = 'published' AND EXISTS (
      SELECT 1 FROM organization_memberships WHERE organization_id = p.organization_id AND user_id = ?1
    ))
    OR (p.status = 'published' AND p.visibility = 'members' AND o.status = 'active' AND EXISTS (
      SELECT 1 FROM organization_affiliations AS organization_affiliation
      JOIN viewer_affiliations ON viewer_affiliations.affiliation_id = organization_affiliation.affiliation_id
      WHERE organization_affiliation.organization_id = p.organization_id
    ))
  )`;

export async function countUnreadNotifications(env: Env, viewer: AuthenticatedUser) {
	return await env.DB.prepare(
		`WITH ${viewerAffiliationsCte}
		 SELECT count(*) AS count
		 FROM notifications AS n
		 LEFT JOIN posts AS p ON p.id = n.post_id
		 LEFT JOIN organizations AS o ON o.id = p.organization_id
		 WHERE ${visibleNotificationWhere} AND n.read_at IS NULL`,
	).bind(viewer.id, viewer.siteRole === "site_admin" ? 1 : 0).first<number>("count") ?? 0;
}

export async function listNotifications(env: Env, viewer: AuthenticatedUser) {
	const result = await env.DB.prepare(
		`WITH ${viewerAffiliationsCte}
		 SELECT n.id, actor.name AS actorName, n.post_id AS postId, n.comment_id AS commentId,
		        n.type, n.body, n.read_at AS readAt, n.created_at AS createdAt
		 FROM notifications AS n
		 LEFT JOIN users AS actor ON actor.id = n.actor_user_id
		 LEFT JOIN posts AS p ON p.id = n.post_id
		 LEFT JOIN organizations AS o ON o.id = p.organization_id
		 WHERE ${visibleNotificationWhere}
		 ORDER BY n.created_at DESC, n.id DESC
		 LIMIT 50`,
	).bind(viewer.id, viewer.siteRole === "site_admin" ? 1 : 0).all<NotificationRecord>();
	return result.results;
}

export async function markNotificationRead(env: Env, userId: string, notificationId: string) {
	const notification = await env.DB.prepare(
		"SELECT post_id AS postId, comment_id AS commentId FROM notifications WHERE id = ?1 AND user_id = ?2",
	).bind(notificationId, userId).first<{ postId: string | null; commentId: string | null }>();
	if (!notification) return null;
	await env.DB.prepare(
		"UPDATE notifications SET read_at = coalesce(read_at, ?1) WHERE id = ?2 AND user_id = ?3",
	).bind(new Date().toISOString(), notificationId, userId).run();
	return notification;
}

export async function markAllNotificationsRead(env: Env, userId: string) {
	await env.DB.prepare(
		"UPDATE notifications SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL",
	).bind(new Date().toISOString(), userId).run();
}
