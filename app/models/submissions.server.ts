import type { AuthenticatedUser } from "../lib/auth.server";

export type SubmissionEntityType = "post" | "comment";

export class SubmissionInProgressError extends Error {
	constructor() {
		super("submission-in-progress");
		this.name = "SubmissionInProgressError";
	}
}

export async function claimSubmission(
	env: Env,
	actor: AuthenticatedUser,
	submissionId: string | null | undefined,
	entityType: SubmissionEntityType,
) {
	if (!submissionId) return { claimed: false as const, entityId: null };
	const inserted = await env.DB.prepare(
		`INSERT OR IGNORE INTO submission_receipts
		 (submission_id, actor_user_id, entity_type, entity_id, created_at)
		 VALUES (?1, ?2, ?3, NULL, ?4)`,
	).bind(submissionId, actor.id, entityType, new Date().toISOString()).run();
	if (inserted.meta.changes > 0) return { claimed: true as const, entityId: null };
	const existing = await env.DB.prepare(
		`SELECT entity_id AS entityId FROM submission_receipts
		 WHERE submission_id = ?1 AND actor_user_id = ?2 AND entity_type = ?3`,
	).bind(submissionId, actor.id, entityType).first<{ entityId: string | null }>();
	if (existing?.entityId) return { claimed: false as const, entityId: existing.entityId };
	throw new SubmissionInProgressError();
}

export function completeSubmissionStatement(
	env: Env,
	actor: AuthenticatedUser,
	submissionId: string | null | undefined,
	entityType: SubmissionEntityType,
	entityId: string,
) {
	if (!submissionId) return null;
	return env.DB.prepare(
		`UPDATE submission_receipts SET entity_id = ?1
		 WHERE submission_id = ?2 AND actor_user_id = ?3 AND entity_type = ?4 AND entity_id IS NULL`,
	).bind(entityId, submissionId, actor.id, entityType);
}

export async function releaseSubmission(
	env: Env,
	actor: AuthenticatedUser,
	submissionId: string | null | undefined,
	entityType: SubmissionEntityType,
) {
	if (!submissionId) return;
	await env.DB.prepare(
		`DELETE FROM submission_receipts
		 WHERE submission_id = ?1 AND actor_user_id = ?2 AND entity_type = ?3 AND entity_id IS NULL`,
	).bind(submissionId, actor.id, entityType).run();
}
