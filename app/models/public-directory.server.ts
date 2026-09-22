export type PublicOrganizationSummary = {
	name: string;
	slug: string;
	summary: string | null;
	category: string | null;
	townCity: string | null;
	region: string | null;
	operatesStatewide: number | null;
	hasLogo: number;
	hasProfilePhoto: number;
};

export type PublicOrganization = PublicOrganizationSummary & {
	description: string | null;
	websiteUrl: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
	socialPlatform: string | null;
	socialHandle: string | null;
	listingRationale: string | null;
	leadershipIdentity: string | null;
	updatedAt: string;
};

const PUBLIC_DIRECTORY_WHERE = "o.status = 'active' AND o.directory_status = 'published'";

export async function listPublishedOrganizations(env: Env) {
	const result = await env.DB.prepare(
		`SELECT o.name,
		        o.slug,
		        o.summary,
		        o.category,
		        o.town_city AS townCity,
		        o.region,
		        o.operates_statewide AS operatesStatewide,
		        CASE WHEN o.logo_object_key IS NULL THEN 0 ELSE 1 END AS hasLogo,
		        CASE WHEN o.profile_photo_object_key IS NULL THEN 0 ELSE 1 END AS hasProfilePhoto
		 FROM organizations AS o
		 WHERE ${PUBLIC_DIRECTORY_WHERE}
		 ORDER BY o.name COLLATE NOCASE`,
	).all<PublicOrganizationSummary>();
	return result.results;
}

export async function getPublishedOrganizationBySlug(env: Env, slug: string) {
	return env.DB.prepare(
		`SELECT o.name,
		        o.slug,
		        o.summary,
		        o.description,
		        o.category,
		        o.website_url AS websiteUrl,
		        o.contact_email AS contactEmail,
		        o.contact_phone AS contactPhone,
		        o.town_city AS townCity,
		        o.region,
		        o.social_platform AS socialPlatform,
		        o.social_handle AS socialHandle,
		        o.listing_rationale AS listingRationale,
		        o.leadership_identity AS leadershipIdentity,
		        o.operates_statewide AS operatesStatewide,
		        o.updated_at AS updatedAt,
		        CASE WHEN o.logo_object_key IS NULL THEN 0 ELSE 1 END AS hasLogo,
		        CASE WHEN o.profile_photo_object_key IS NULL THEN 0 ELSE 1 END AS hasProfilePhoto
		 FROM organizations AS o
		 WHERE ${PUBLIC_DIRECTORY_WHERE}
		   AND o.slug = ?1
		 LIMIT 1`,
	)
		.bind(slug)
		.first<PublicOrganization>();
}

export async function getPublishedOrganizationMediaKey(
	env: Env,
	slug: string,
	kind: "logo" | "photo",
) {
	const column = kind === "logo" ? "logo_object_key" : "profile_photo_object_key";
	return env.DB.prepare(
		`SELECT o.${column} AS objectKey
		 FROM organizations AS o
		 WHERE ${PUBLIC_DIRECTORY_WHERE}
		   AND o.slug = ?1
		   AND o.${column} IS NOT NULL
		 LIMIT 1`,
	)
		.bind(slug)
		.first<string>("objectKey");
}
