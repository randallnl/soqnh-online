import { z } from "zod";

import type { AuthenticatedUser } from "../lib/auth.server";
import { scraperParsers } from "../lib/scraper";

const optionalString = (maximum: number) =>
	z.preprocess(
		(value) => (typeof value === "string" ? value.trim() : ""),
		z.string().max(maximum),
	);

export const scraperRecordSchema = z.object({
	partner: z.string().trim().min(1).max(120),
	title: z.string().trim().min(1).max(240),
	start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	end_date: optionalString(10),
	start_time: optionalString(8),
	end_time: optionalString(8),
	location: optionalString(500),
	description: optionalString(4000),
	image_url: optionalString(2048),
	url: optionalString(2048),
	source_url: optionalString(2048),
	kind: optionalString(40),
	scraped_at: optionalString(80),
});

export const scraperPayloadSchema = z.object({
	records: z.array(z.unknown()).max(500),
});

type ScraperRecord = z.infer<typeof scraperRecordSchema>;
type ImportOutcome = "imported" | "updated" | "duplicate" | "invalid";

export type ScraperRunRecord = {
	id: string;
	triggerType: "manual" | "callback";
	status: "running" | "succeeded" | "failed";
	initiatedByName: string | null;
	partnersCount: number;
	scrapedCount: number;
	submittedCount: number;
	importedCount: number;
	updatedCount: number;
	skippedCount: number;
	failureCount: number;
	errorMessage: string | null;
	startedAt: string;
	finishedAt: string | null;
};

export type ScraperImportRecord = {
	id: string;
	organizationName: string | null;
	postId: string | null;
	outcome: ImportOutcome;
	title: string | null;
	startsAt: string | null;
	sourceUrl: string | null;
	reason: string | null;
	createdAt: string;
};

function normalizeTime(value: string) {
	if (!value) return "00:00";
	const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return null;
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function combineDateTime(date: string, time: string) {
	const normalizedTime = normalizeTime(time);
	if (!normalizedTime) return null;
	const value = `${date}T${normalizedTime}`;
	const parsed = new Date(`${value}:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
		return null;
	}
	return value;
}

function cleanUrl(value: string) {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
}

async function sha256(value: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordImport(
	env: Env,
	input: {
		runId: string | null;
		organizationId: string | null;
		postId: string | null;
		externalId: string | null;
		outcome: ImportOutcome;
		title: string | null;
		startsAt: string | null;
		sourceUrl: string | null;
		reason: string | null;
		payload: unknown;
	},
) {
	await env.DB.prepare(
		`INSERT INTO scraper_imports
		 (id, run_id, organization_id, post_id, external_id, outcome, title,
		  starts_at, source_url, reason, payload_json, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
	)
		.bind(
			crypto.randomUUID(), input.runId, input.organizationId, input.postId,
			input.externalId, input.outcome, input.title, input.startsAt,
			input.sourceUrl, input.reason, JSON.stringify(input.payload),
			new Date().toISOString(),
		)
		.run();
}

export async function listScraperPartners(env: Env) {
	const result = await env.DB.prepare(
		`SELECT name, event_source_url AS url, event_parser AS parser
		 FROM organizations
		 WHERE status = 'active'
		   AND event_scraping_enabled = 1
		   AND event_source_url IS NOT NULL
		   AND event_parser IS NOT NULL
		 ORDER BY name COLLATE NOCASE`,
	).all<{ name: string; url: string; parser: string }>();
	return result.results;
}

export async function importScraperRecords(
	env: Env,
	records: unknown[],
	runId: string | null,
) {
	await env.DB.prepare(
		`INSERT INTO users
		 (id, email, name, site_role, status, created_at, updated_at, profile_visibility)
		 VALUES ('system:event-scraper', 'event-scraper@system.local', 'Event scraper',
		         'member', 'active', ?1, ?1, 'hidden')
		 ON CONFLICT(id) DO NOTHING`,
	)
		.bind(new Date().toISOString())
		.run();

	const counts: Record<ImportOutcome, number> = {
		imported: 0,
		updated: 0,
		duplicate: 0,
		invalid: 0,
	};

	for (const raw of records) {
		const parsed = scraperRecordSchema.safeParse(raw);
		if (!parsed.success) {
			counts.invalid += 1;
			await recordImport(env, {
				runId, organizationId: null, postId: null, externalId: null,
				outcome: "invalid", title: typeof raw === "object" && raw && "title" in raw && typeof raw.title === "string" ? raw.title.slice(0, 240) : null,
				startsAt: null, sourceUrl: null,
				reason: parsed.error.issues[0]?.message ?? "Invalid scraper record",
				payload: raw,
			});
			continue;
		}

		const record = parsed.data;
		const organization = await env.DB.prepare(
			`SELECT id FROM organizations
			 WHERE name = ?1 COLLATE NOCASE AND status = 'active' LIMIT 1`,
		)
			.bind(record.partner)
			.first<{ id: string }>();
		const startsAt = combineDateTime(record.start_date, record.start_time);
		const externalUrl = cleanUrl(record.url);
		const sourceUrl = cleanUrl(record.source_url) ?? externalUrl;
		const imageUrl = cleanUrl(record.image_url);
		const endDate = record.end_date || record.start_date;
		const endsAt = record.end_date || record.end_time
			? combineDateTime(endDate, record.end_time || record.start_time)
			: null;
		let invalidReason: string | null = null;
		if (!organization) invalidReason = "No active organization matches the partner name";
		else if ((record.kind || "event") !== "event") invalidReason = "Record is not an event";
		else if (!startsAt) invalidReason = "Start date or time is invalid";
		else if ((record.end_date || record.end_time) && !endsAt) invalidReason = "End date or time is invalid";
		else if (endsAt && endsAt < startsAt) invalidReason = "End date or time precedes the start";

		if (invalidReason || !organization || !startsAt) {
			counts.invalid += 1;
			await recordImport(env, {
				runId, organizationId: organization?.id ?? null, postId: null,
				externalId: null, outcome: "invalid", title: record.title, startsAt,
				sourceUrl, reason: invalidReason, payload: record,
			});
			continue;
		}

		const externalId = await sha256(
			`${organization.id}|${externalUrl ?? sourceUrl ?? ""}|${record.title.toLowerCase()}|${record.start_date}`,
		);
		const exact = await env.DB.prepare(
			`SELECT p.id AS postId, p.status, e.moderation_status AS moderationStatus
			 FROM events AS e JOIN posts AS p ON p.id = e.post_id
			 WHERE e.external_id = ?1 LIMIT 1`,
		)
			.bind(externalId)
			.first<{ postId: string; status: string; moderationStatus: string }>();

		if (exact?.moderationStatus === "approved") {
			counts.duplicate += 1;
			await recordImport(env, {
				runId, organizationId: organization.id, postId: exact.postId,
				externalId, outcome: "duplicate", title: record.title, startsAt,
				sourceUrl, reason: "An approved import already has this scraper identity",
				payload: record,
			});
			continue;
		}

		if (exact) {
			const now = new Date().toISOString();
			await env.DB.batch([
				env.DB.prepare(
					`UPDATE posts SET title = ?1, body = ?2, status = 'draft', updated_at = ?3,
					 archived_at = NULL WHERE id = ?4`,
				).bind(record.title, record.description, now, exact.postId),
				env.DB.prepare(
					`UPDATE events SET starts_at = ?1, ends_at = ?2, location_name = ?3,
					 registration_url = ?4, source_url = ?5, external_url = ?6,
					 scraped_at = ?7, image_url = ?8, moderation_status = 'pending',
					 reviewed_by_user_id = NULL, reviewed_at = NULL, rejection_reason = NULL
					 WHERE post_id = ?9`,
				).bind(startsAt, endsAt, record.location || null, externalUrl, sourceUrl,
					externalUrl, record.scraped_at || now, imageUrl, exact.postId),
			]);
			counts.updated += 1;
			await recordImport(env, {
				runId, organizationId: organization.id, postId: exact.postId,
				externalId, outcome: "updated", title: record.title, startsAt,
				sourceUrl, reason: null, payload: record,
			});
			continue;
		}

		const likelyDuplicate = await env.DB.prepare(
			`SELECT p.id AS postId
			 FROM posts AS p JOIN events AS e ON e.post_id = p.id
			 WHERE p.organization_id = ?1 AND p.section = 'event'
			   AND (
			     (lower(trim(p.title)) = lower(trim(?2)) AND substr(e.starts_at, 1, 10) = ?3)
			     OR (?4 IS NOT NULL AND (e.external_url = ?4 OR e.source_url = ?4 OR e.registration_url = ?4))
			   )
			 LIMIT 1`,
		)
			.bind(organization.id, record.title, record.start_date, externalUrl)
			.first<{ postId: string }>();
		if (likelyDuplicate) {
			counts.duplicate += 1;
			await recordImport(env, {
				runId, organizationId: organization.id, postId: likelyDuplicate.postId,
				externalId, outcome: "duplicate", title: record.title, startsAt,
				sourceUrl, reason: "A likely event match already exists",
				payload: record,
			});
			continue;
		}

		const postId = crypto.randomUUID();
		const now = new Date().toISOString();
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO posts
				 (id, organization_id, author_user_id, section, title, body, visibility,
				  status, created_at, updated_at, archived_at)
				 VALUES (?1, ?2, 'system:event-scraper', 'event', ?3, ?4, 'members',
				         'draft', ?5, ?5, NULL)`,
			).bind(postId, organization.id, record.title, record.description, now),
			env.DB.prepare(
				`INSERT INTO events
				 (post_id, starts_at, ends_at, location_name, location_url,
				  registration_url, source_url, external_url, external_id, scraped_at,
				  image_url, moderation_status, reviewed_by_user_id, reviewed_at, rejection_reason)
				 VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9, ?10,
				         'pending', NULL, NULL, NULL)`,
			).bind(postId, startsAt, endsAt, record.location || null, externalUrl,
				sourceUrl, externalUrl, externalId, record.scraped_at || now, imageUrl),
		]);
		counts.imported += 1;
		await recordImport(env, {
			runId, organizationId: organization.id, postId, externalId,
			outcome: "imported", title: record.title, startsAt, sourceUrl,
			reason: null, payload: record,
		});
	}

	return {
		imported: counts.imported + counts.updated,
		new: counts.imported,
		updated: counts.updated,
		skipped: counts.duplicate + counts.invalid,
		duplicates: counts.duplicate,
		invalid: counts.invalid,
	};
}

export async function createManualScraperRun(env: Env, actor: AuthenticatedUser) {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO scraper_runs
		 (id, trigger_type, status, initiated_by_user_id, started_at, created_at, updated_at)
		 VALUES (?1, 'manual', 'running', ?2, ?3, ?3, ?3)`,
	)
		.bind(id, actor.id, now)
		.run();
	return id;
}

export async function finishManualScraperRun(
	env: Env,
	runId: string,
	result: Record<string, unknown>,
) {
	const number = (key: string) => {
		const value = result[key];
		return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
	};
	const failures = Array.isArray(result.failures) ? result.failures.length : 0;
	const now = new Date().toISOString();
	await env.DB.prepare(
		`UPDATE scraper_runs SET status = 'succeeded', partners_count = ?1,
		 scraped_count = ?2, submitted_count = ?3, imported_count = ?4,
		 updated_count = ?5, skipped_count = ?6, failure_count = ?7,
		 result_json = ?8, finished_at = ?9, updated_at = ?9 WHERE id = ?10`,
	)
		.bind(number("partners"), number("scraped"), number("submitted"),
			number("imported"), number("updated"), number("skipped"), failures,
			JSON.stringify(result), now, runId)
		.run();
}

export async function failManualScraperRun(env: Env, runId: string, message: string) {
	const now = new Date().toISOString();
	await env.DB.prepare(
		`UPDATE scraper_runs SET status = 'failed', error_message = ?1,
		 finished_at = ?2, updated_at = ?2 WHERE id = ?3`,
	)
		.bind(message.slice(0, 1000), now, runId)
		.run();
}

export async function getScraperAdministrationData(env: Env) {
	const [runs, imports, organizations] = await Promise.all([
		env.DB.prepare(
			`SELECT r.id, r.trigger_type AS triggerType, r.status,
			 u.name AS initiatedByName, r.partners_count AS partnersCount,
			 r.scraped_count AS scrapedCount, r.submitted_count AS submittedCount,
			 r.imported_count AS importedCount, r.updated_count AS updatedCount,
			 r.skipped_count AS skippedCount, r.failure_count AS failureCount,
			 r.error_message AS errorMessage, r.started_at AS startedAt,
			 r.finished_at AS finishedAt
			 FROM scraper_runs AS r LEFT JOIN users AS u ON u.id = r.initiated_by_user_id
			 ORDER BY r.started_at DESC LIMIT 25`,
		).all<ScraperRunRecord>(),
		env.DB.prepare(
			`SELECT i.id, o.name AS organizationName, i.post_id AS postId, i.outcome,
			 i.title, i.starts_at AS startsAt, i.source_url AS sourceUrl,
			 i.reason, i.created_at AS createdAt
			 FROM scraper_imports AS i
			 LEFT JOIN organizations AS o ON o.id = i.organization_id
			 ORDER BY i.created_at DESC LIMIT 100`,
		).all<ScraperImportRecord>(),
		env.DB.prepare(
			`SELECT id, name, status, event_source_url AS eventSourceUrl,
			 event_parser AS eventParser, event_scraping_enabled AS eventScrapingEnabled
			 FROM organizations ORDER BY name COLLATE NOCASE`,
		).all<{
			id: string; name: string; status: string; eventSourceUrl: string | null;
			eventParser: string | null; eventScrapingEnabled: number;
		}>(),
	]);
	return { runs: runs.results, imports: imports.results, organizations: organizations.results };
}

export async function updateOrganizationScraperSettings(
	env: Env,
	actor: AuthenticatedUser,
	input: {
		organizationId: string;
		eventSourceUrl: string | null;
		eventParser: typeof scraperParsers[number] | null;
		eventScrapingEnabled: boolean;
	},
) {
	if (input.eventScrapingEnabled && (!input.eventSourceUrl || !input.eventParser)) {
		throw new Error("An enabled scraper needs a source URL and parser.");
	}
	const now = new Date().toISOString();
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE organizations SET event_source_url = ?1, event_parser = ?2,
			 event_scraping_enabled = ?3, updated_at = ?4 WHERE id = ?5`,
		).bind(input.eventSourceUrl, input.eventParser, input.eventScrapingEnabled ? 1 : 0, now, input.organizationId),
		env.DB.prepare(
			`INSERT INTO audit_log
			 (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 SELECT ?1, ?2, 'organization.scraper_settings_updated', 'organization',
			 ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?3 AND updated_at = ?5)`,
		).bind(crypto.randomUUID(), actor.id, input.organizationId, JSON.stringify({
			enabled: input.eventScrapingEnabled,
			parser: input.eventParser,
		}), now),
	]);
	if (results[0]?.meta.changes !== 1) throw new Error("Organization not found.");
}
