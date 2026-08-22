import type { AuditEntityType } from "../lib/admin";

export type AdminOperationsMetrics = {
	activeMembers: number;
	invitedMembers: number;
	suspendedMembers: number;
	activeOrganizations: number;
	organizationsWithoutAffiliations: number;
	affiliations: number;
	publishedPosts: number;
	draftPosts: number;
	pendingEvents: number;
	activeInvitations: number;
	enabledScraperSources: number;
};

export type AdminAuditEvent = {
	id: string;
	action: string;
	entityType: string;
	entityId: string;
	entityLabel: string;
	actorName: string | null;
	actorEmail: string | null;
	createdAt: string;
};

export type LatestScraperRun = {
	id: string;
	status: "running" | "succeeded" | "failed";
	triggerType: "manual" | "callback";
	startedAt: string;
	finishedAt: string | null;
	importedCount: number;
	failureCount: number;
	errorMessage: string | null;
};

const auditSelection = `SELECT a.id, a.action,
	       a.entity_type AS entityType,
	       a.entity_id AS entityId,
	       coalesce(
	         CASE a.entity_type
	           WHEN 'user' THEN (SELECT coalesce(name, email) FROM users WHERE id = a.entity_id)
	           WHEN 'organization' THEN (SELECT name FROM organizations WHERE id = a.entity_id)
	           WHEN 'affiliation' THEN (SELECT name FROM affiliations WHERE id = a.entity_id)
	           WHEN 'invitation' THEN (SELECT email FROM invitations WHERE id = a.entity_id)
	           WHEN 'post' THEN (SELECT title FROM posts WHERE id = a.entity_id)
	           WHEN 'event' THEN (SELECT title FROM posts WHERE id = a.entity_id)
	           WHEN 'comment' THEN (
	             SELECT p.title FROM comments AS c JOIN posts AS p ON p.id = c.post_id
	             WHERE c.id = a.entity_id
	           )
	         END,
	         a.entity_id
	       ) AS entityLabel,
	       actor.name AS actorName,
	       actor.email AS actorEmail,
	       a.created_at AS createdAt
	FROM audit_log AS a
	LEFT JOIN users AS actor ON actor.id = a.actor_user_id`;

export async function getAdminOperationsData(env: Env) {
	const now = new Date().toISOString();
	const [metrics, auditResult, latestScraperRun] = await Promise.all([
		env.DB.prepare(
			`SELECT
			 (SELECT count(*) FROM users WHERE status = 'active' AND id != 'system:event-scraper') AS activeMembers,
			 (SELECT count(*) FROM users WHERE status = 'invited') AS invitedMembers,
			 (SELECT count(*) FROM users WHERE status = 'suspended') AS suspendedMembers,
			 (SELECT count(*) FROM organizations WHERE status = 'active') AS activeOrganizations,
			 (SELECT count(*) FROM organizations AS o WHERE o.status = 'active' AND NOT EXISTS (
			    SELECT 1 FROM organization_affiliations WHERE organization_id = o.id
			  )) AS organizationsWithoutAffiliations,
			 (SELECT count(*) FROM affiliations) AS affiliations,
			 (SELECT count(*) FROM posts WHERE status = 'published') AS publishedPosts,
			 (SELECT count(*) FROM posts WHERE status = 'draft') AS draftPosts,
			 (SELECT count(*) FROM events WHERE moderation_status = 'pending') AS pendingEvents,
			 (SELECT count(*) FROM invitations WHERE accepted_at IS NULL AND expires_at > ?1) AS activeInvitations,
			 (SELECT count(*) FROM organizations WHERE status = 'active' AND event_scraping_enabled = 1) AS enabledScraperSources`,
		).bind(now).first<AdminOperationsMetrics>(),
		env.DB.prepare(`${auditSelection} ORDER BY a.created_at DESC, a.id DESC LIMIT 8`).all<AdminAuditEvent>(),
		env.DB.prepare(
			`SELECT id, status, trigger_type AS triggerType,
			        started_at AS startedAt, finished_at AS finishedAt,
			        imported_count AS importedCount, failure_count AS failureCount,
			        error_message AS errorMessage
			 FROM scraper_runs ORDER BY started_at DESC, id DESC LIMIT 1`,
		).first<LatestScraperRun>(),
	]);

	return {
		metrics: metrics ?? {
			activeMembers: 0,
			invitedMembers: 0,
			suspendedMembers: 0,
			activeOrganizations: 0,
			organizationsWithoutAffiliations: 0,
			affiliations: 0,
			publishedPosts: 0,
			draftPosts: 0,
			pendingEvents: 0,
			activeInvitations: 0,
			enabledScraperSources: 0,
		},
		recentAuditEvents: auditResult.results,
		latestScraperRun,
	};
}

const AUDIT_PAGE_SIZE = 30;

export async function listAuditEvents(
	env: Env,
	input: { entityType: AuditEntityType | null; page: number },
) {
	const where = input.entityType ? " WHERE a.entity_type = ?1" : "";
	const offset = (input.page - 1) * AUDIT_PAGE_SIZE;
	const rowStatement = env.DB.prepare(
		`${auditSelection}${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?${input.entityType ? 2 : 1} OFFSET ?${input.entityType ? 3 : 2}`,
	);
	const countStatement = env.DB.prepare(
		`SELECT count(*) AS count FROM audit_log AS a${where}`,
	);
	const [rowResult, count] = input.entityType
		? await Promise.all([
			rowStatement.bind(input.entityType, AUDIT_PAGE_SIZE, offset).all<AdminAuditEvent>(),
			countStatement.bind(input.entityType).first<number>("count"),
		])
		: await Promise.all([
			rowStatement.bind(AUDIT_PAGE_SIZE, offset).all<AdminAuditEvent>(),
			countStatement.first<number>("count"),
		]);
	const total = count ?? 0;
	return {
		events: rowResult.results,
		page: input.page,
		total,
		totalPages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
	};
}
