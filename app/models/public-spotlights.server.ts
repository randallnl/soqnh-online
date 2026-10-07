import type { AuthenticatedUser } from "../lib/auth.server";

export type PublicSpotlightRecord = {
	id: string;
	eyebrow: string | null;
	headline: string;
	message: string;
	imageObjectKey: string;
	imageAlt: string;
	photoCredit: string | null;
	primaryButtonLabel: string | null;
	primaryButtonUrl: string | null;
	secondaryButtonLabel: string | null;
	secondaryButtonUrl: string | null;
	sortOrder: number;
	isActive: number;
	createdAt: string;
	updatedAt: string;
};

export type PublicSpotlightInput = Omit<PublicSpotlightRecord, "id" | "imageObjectKey" | "createdAt" | "updatedAt" | "isActive"> & {
	isActive: boolean;
};

export class PublicSpotlightMutationError extends Error {
	constructor(public readonly reason: "forbidden" | "not-found") {
		super(reason);
		this.name = "PublicSpotlightMutationError";
	}
}

const selectFields = `id, eyebrow, headline, message,
	image_object_key AS imageObjectKey, image_alt AS imageAlt, photo_credit AS photoCredit,
	primary_button_label AS primaryButtonLabel, primary_button_url AS primaryButtonUrl,
	secondary_button_label AS secondaryButtonLabel, secondary_button_url AS secondaryButtonUrl,
	sort_order AS sortOrder, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt`;

function requireAdmin(actor: AuthenticatedUser) {
	if (actor.siteRole !== "site_admin") throw new PublicSpotlightMutationError("forbidden");
}

export async function listActivePublicSpotlights(env: Env) {
	const result = await env.DB.prepare(
		`SELECT ${selectFields} FROM public_spotlights
		 WHERE is_active = 1 ORDER BY sort_order, created_at, id`,
	).all<PublicSpotlightRecord>();
	return result.results;
}

export async function listPublicSpotlightsForAdmin(env: Env) {
	const result = await env.DB.prepare(
		`SELECT ${selectFields} FROM public_spotlights ORDER BY sort_order, created_at, id`,
	).all<PublicSpotlightRecord>();
	return result.results;
}

export async function createPublicSpotlight(env: Env, actor: AuthenticatedUser, input: PublicSpotlightInput & { imageObjectKey: string; id: string }) {
	requireAdmin(actor);
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO public_spotlights
			 (id, eyebrow, headline, message, image_object_key, image_alt, photo_credit,
			  primary_button_label, primary_button_url, secondary_button_label, secondary_button_url,
			  sort_order, is_active, created_by_user_id, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`,
		).bind(input.id, input.eyebrow, input.headline, input.message, input.imageObjectKey, input.imageAlt, input.photoCredit,
			input.primaryButtonLabel, input.primaryButtonUrl, input.secondaryButtonLabel, input.secondaryButtonUrl,
			input.sortOrder, input.isActive ? 1 : 0, actor.id, now),
		env.DB.prepare(
			`INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'public_spotlight.created', 'public_spotlight', ?3, ?4, ?5)`,
		).bind(crypto.randomUUID(), actor.id, input.id, JSON.stringify({ headline: input.headline, isActive: input.isActive }), now),
	]);
}

export async function updatePublicSpotlight(env: Env, actor: AuthenticatedUser, input: PublicSpotlightInput & { spotlightId: string; imageObjectKey?: string }) {
	requireAdmin(actor);
	const existing = await env.DB.prepare("SELECT image_object_key AS imageObjectKey FROM public_spotlights WHERE id = ?1")
		.bind(input.spotlightId).first<{ imageObjectKey: string }>();
	if (!existing) throw new PublicSpotlightMutationError("not-found");
	const now = new Date().toISOString();
	const imageObjectKey = input.imageObjectKey ?? existing.imageObjectKey;
	const result = await env.DB.batch([
		env.DB.prepare(
			`UPDATE public_spotlights SET eyebrow = ?1, headline = ?2, message = ?3,
			 image_object_key = ?4, image_alt = ?5, photo_credit = ?6,
			 primary_button_label = ?7, primary_button_url = ?8,
			 secondary_button_label = ?9, secondary_button_url = ?10,
			 sort_order = ?11, is_active = ?12, updated_at = ?13 WHERE id = ?14`,
		).bind(input.eyebrow, input.headline, input.message, imageObjectKey, input.imageAlt, input.photoCredit,
			input.primaryButtonLabel, input.primaryButtonUrl, input.secondaryButtonLabel, input.secondaryButtonUrl,
			input.sortOrder, input.isActive ? 1 : 0, now, input.spotlightId),
		env.DB.prepare(
			`INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'public_spotlight.updated', 'public_spotlight', ?3, ?4, ?5)`,
		).bind(crypto.randomUUID(), actor.id, input.spotlightId, JSON.stringify({ headline: input.headline, isActive: input.isActive }), now),
	]);
	if ((result[0].meta.changes ?? 0) !== 1) throw new PublicSpotlightMutationError("not-found");
	return { previousImageObjectKey: existing.imageObjectKey, imageObjectKey };
}

export async function deletePublicSpotlight(env: Env, actor: AuthenticatedUser, spotlightId: string) {
	requireAdmin(actor);
	const existing = await env.DB.prepare("SELECT image_object_key AS imageObjectKey, headline FROM public_spotlights WHERE id = ?1")
		.bind(spotlightId).first<{ imageObjectKey: string; headline: string }>();
	if (!existing) throw new PublicSpotlightMutationError("not-found");
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare("DELETE FROM public_spotlights WHERE id = ?1").bind(spotlightId),
		env.DB.prepare(
			`INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
			 VALUES (?1, ?2, 'public_spotlight.deleted', 'public_spotlight', ?3, ?4, ?5)`,
		).bind(crypto.randomUUID(), actor.id, spotlightId, JSON.stringify({ headline: existing.headline }), now),
	]);
	return existing.imageObjectKey;
}

export async function getPublicSpotlightImageKey(env: Env, spotlightId: string) {
	const row = await env.DB.prepare("SELECT image_object_key AS imageObjectKey FROM public_spotlights WHERE id = ?1")
		.bind(spotlightId).first<{ imageObjectKey: string }>();
	return row?.imageObjectKey ?? null;
}
