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

export type PublicOrganizationEvent = {
	title: string;
	startsAt: string;
	endsAt: string | null;
	locationName: string | null;
	registrationUrl: string | null;
	sourceUrl: string | null;
	externalUrl: string | null;
	imageUrl: string | null;
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

export async function listPublishedOrganizationUpcomingEvents(
	env: Env,
	slug: string,
	today = new Date().toISOString().slice(0, 10),
) {
	const result = await env.DB.prepare(
		`SELECT p.title,
		        e.starts_at AS startsAt,
		        e.ends_at AS endsAt,
		        e.location_name AS locationName,
		        e.registration_url AS registrationUrl,
		        e.source_url AS sourceUrl,
		        e.external_url AS externalUrl,
		        e.image_url AS imageUrl
		 FROM organizations AS o
		 JOIN posts AS p ON p.organization_id = o.id
		 JOIN events AS e ON e.post_id = p.id
		 WHERE ${PUBLIC_DIRECTORY_WHERE}
		   AND o.slug = ?1
		   AND p.section = 'event'
		   AND p.status = 'published'
		   AND p.visibility = 'members'
		   AND e.moderation_status = 'approved'
		   AND substr(e.starts_at, 1, 10) >= ?2
		   AND NOT EXISTS (
		     SELECT 1 FROM post_affiliations AS pa WHERE pa.post_id = p.id
		   )
		 ORDER BY e.starts_at, p.created_at, p.id
		 LIMIT 3`,
	)
		.bind(slug, today)
		.all<PublicOrganizationEvent>();
	return result.results;
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
