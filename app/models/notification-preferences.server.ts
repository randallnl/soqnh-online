import type { AuthenticatedUser } from "../lib/auth.server";

export type EmailNotificationRecipient = Pick<AuthenticatedUser, "id" | "email" | "name" | "siteRole" | "status">;

function placeholders(values: string[]) {
	return values.map((_, index) => `?${index + 1}`).join(", ");
}

export async function listMentionEmailRecipients(env: Env, userIds: string[]) {
	const uniqueIds = [...new Set(userIds)].slice(0, 10);
	if (uniqueIds.length === 0) return [];
	const result = await env.DB.prepare(
		`SELECT id, email, name, site_role AS siteRole, status
		 FROM users
		 WHERE id IN (${placeholders(uniqueIds)})
		   AND status = 'active'
		   AND mention_email_enabled = 1
		 ORDER BY id`,
	).bind(...uniqueIds).all<EmailNotificationRecipient>();
	return result.results;
}

export async function getSupportEmailRecipient(env: Env, userId: string) {
	return env.DB.prepare(
		`SELECT id, email, name, site_role AS siteRole, status
		 FROM users
		 WHERE id = ?1
		   AND status = 'active'
		   AND support_email_enabled = 1`,
	).bind(userId).first<EmailNotificationRecipient>();
}

export async function listWeeklyDigestRecipients(env: Env) {
	const result = await env.DB.prepare(
		`SELECT id, email, name, site_role AS siteRole, status
		 FROM users
		 WHERE status = 'active'
		   AND id != 'system:event-scraper'
		   AND weekly_digest_enabled = 1
		 ORDER BY id`,
	).all<EmailNotificationRecipient>();
	return result.results;
}
