export async function getContentImagePostId(env: Env, objectKey: string) {
	if (!objectKey.startsWith("content-images/")) return null;
	const row = await env.DB.prepare(
		`SELECT coalesce(a.post_id, c.post_id) AS postId
		 FROM attachments AS a
		 LEFT JOIN comments AS c ON c.id = a.comment_id
		 WHERE a.object_key = ?1
		   AND (a.post_id IS NOT NULL OR c.status = 'published')
		 LIMIT 1`,
	).bind(objectKey).first<{ postId: string }>();
	return row?.postId ?? null;
}
