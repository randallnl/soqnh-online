import { Link } from "react-router";

import type { Route } from "./+types/public-organization-detail";
import { Icon } from "~/components/icon";
import { MentionText } from "~/components/mention-textarea";
import { formatEventDateTime } from "~/lib/events";
import { initials } from "~/lib/media";
import { organizationCategoryTone, parseOrganizationCategories } from "~/lib/organization-categories";
import { parseOrganizationLeadership } from "~/lib/organization-leadership";
import { getPublishedOrganizationBySlug, listPublishedOrganizationUpcomingEvents } from "~/models/public-directory.server";

function socialUrl(platform: string | null, handle: string) {
	if (/^https?:\/\//i.test(handle)) return handle;
	const account = handle.replace(/^@/, "").replace(/^\/+|\/+$/g, "");
	if (platform?.toLowerCase() === "instagram") return `https://www.instagram.com/${account}`;
	if (platform?.toLowerCase() === "facebook") return `https://www.facebook.com/${account}`;
	if (platform?.toLowerCase() === "tiktok") return `https://www.tiktok.com/@${account}`;
	return null;
}

function safeHttpUrl(value: string | null) {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
}

export function meta({ data }: Route.MetaArgs) {
	const organization = data?.organization;
	return [
		{ title: `${organization?.name ?? "Organization"} · NH Connect Directory` },
		{ name: "description", content: organization?.summary ?? "An affirming organization in the NH Connect public directory." },
	];
}

export function headers() {
	return { "Cache-Control": "no-store" };
}

export async function loader({ context, params }: Route.LoaderArgs) {
	const [organization, upcomingEvents] = await Promise.all([
		getPublishedOrganizationBySlug(context.cloudflare.env, params.slug),
		listPublishedOrganizationUpcomingEvents(context.cloudflare.env, params.slug),
	]);
	if (!organization) throw new Response("Organization not found", { status: 404 });
	return { organization, upcomingEvents };
}

export default function PublicOrganizationDetail({ loaderData }: Route.ComponentProps) {
	const { organization, upcomingEvents } = loaderData;
	const categories = parseOrganizationCategories(organization.category);
	const leadership = parseOrganizationLeadership(organization.leadershipIdentity).filter((label) => label !== "Prefer not to say");
	const organizationSocialUrl = organization.socialHandle ? socialUrl(organization.socialPlatform, organization.socialHandle) : null;
	const location = organization.operatesStatewide === 1 ? "Serving communities statewide" : [organization.townCity, organization.region].filter(Boolean).join(", ");
	return <article className="public-organization-page">
		<Link className="public-directory-back" to="/"><span>←</span> Back to the directory</Link>
		<section className="public-organization-profile">
			{organization.hasProfilePhoto ? <img alt={`${organization.name}`} className="public-organization-photo" src={`/directory/${encodeURIComponent(organization.slug)}/media/photo`} /> : <div className="public-organization-photo-placeholder" />}
			<div className="public-organization-intro">
				<span className="public-directory-logo public-directory-logo--large">{organization.hasLogo ? <img alt="" src={`/directory/${encodeURIComponent(organization.slug)}/media/logo`} /> : initials(organization.name, "Organization")}</span>
				<p className="eyebrow">NH Connect public directory</p>
				<h1>{organization.name}</h1>
				<p>{organization.summary || "An affirming organization in New Hampshire’s community ecosystem."}</p>
				{location && <span className="public-organization-location"><Icon name="building" size={16} /> {location}</span>}
			</div>
		</section>
		{upcomingEvents.length > 0 && <section aria-labelledby="public-upcoming-events-heading" className="public-upcoming-events">
			<header>
				<div><p className="eyebrow">Gather with them</p><h2 id="public-upcoming-events-heading">Upcoming events</h2></div>
				<span>{upcomingEvents.length} {upcomingEvents.length === 1 ? "event" : "events"}</span>
			</header>
			<div className="public-upcoming-event-grid">
				{upcomingEvents.map((event) => {
					const eventUrl = safeHttpUrl(event.registrationUrl) || safeHttpUrl(event.externalUrl) || safeHttpUrl(event.sourceUrl);
					const imageUrl = safeHttpUrl(event.imageUrl);
					const contents = <>
						<div className="public-upcoming-event-image">{imageUrl ? <img alt="" loading="lazy" referrerPolicy="no-referrer" src={imageUrl} /> : <Icon name="calendar" size={28} />}</div>
						<div className="public-upcoming-event-body">
							<p>{formatEventDateTime(event.startsAt)}</p>
							<h3>{event.title}</h3>
							{event.locationName && <span><Icon name="building" size={15} /> {event.locationName}</span>}
							{eventUrl && <strong>View event <Icon name="chevron-right" size={15} /></strong>}
						</div>
					</>;
					return eventUrl
						? <a className="public-upcoming-event-card" href={eventUrl} key={`${event.startsAt}-${event.title}`} rel="noopener noreferrer" target="_blank">{contents}</a>
						: <article className="public-upcoming-event-card" key={`${event.startsAt}-${event.title}`}>{contents}</article>;
				})}
			</div>
		</section>}

		<div className="public-organization-columns">
			<div className="public-organization-main">
				{organization.description && <section><p className="eyebrow">About</p><div className="public-organization-description"><MentionText targets={[]} text={organization.description} /></div></section>}
				{categories.length > 0 && <section><p className="eyebrow">What they offer</p><div className="public-directory-tags public-directory-tags--large">{categories.map((category) => <span className={`organization-category-chip organization-category-tone--${organizationCategoryTone(category)}`} key={category}>{category}</span>)}</div></section>}
				{leadership.length > 0 && <section><p className="eyebrow">Community identity</p><div className="public-directory-tags public-directory-tags--large">{leadership.map((label) => <span className={`organization-category-chip ${label === "Queer-led" ? "organization-category-tone--plum" : label === "BIPOC-led" ? "organization-category-tone--gold" : "organization-category-tone--blue"}`} key={label}>{label}</span>)}</div></section>}
				{organization.listingRationale && <section className="public-organization-note"><p className="eyebrow">Why it is included</p><MentionText targets={[]} text={organization.listingRationale} /></section>}
			</div>
			<aside className="public-organization-connect">
				<p className="eyebrow">Connect</p>
				<h2>Get in touch</h2>
				<div>
					{organization.websiteUrl && <a href={organization.websiteUrl} rel="noopener noreferrer" target="_blank"><Icon name="activity" size={17} /><span><small>Website</small><strong>Visit their website</strong></span></a>}
					{organization.contactEmail && <a href={`mailto:${organization.contactEmail}`}><Icon name="message" size={17} /><span><small>Email</small><strong>{organization.contactEmail}</strong></span></a>}
					{organization.contactPhone && <a href={`tel:${organization.contactPhone.replace(/[^+\d]/g, "")}`}><Icon name="activity" size={17} /><span><small>Phone</small><strong>{organization.contactPhone}</strong></span></a>}
					{organization.socialHandle && (organizationSocialUrl ? <a href={organizationSocialUrl} rel="noopener noreferrer" target="_blank"><Icon name="people" size={17} /><span><small>{organization.socialPlatform || "Social media"}</small><strong>{organization.socialHandle}</strong></span></a> : <span className="public-organization-contact-static"><Icon name="people" size={17} /><span><small>{organization.socialPlatform || "Social media"}</small><strong>{organization.socialHandle}</strong></span></span>)}
				</div>
				<p className="public-organization-updated">Profile updated {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(organization.updatedAt))}</p>
			</aside>
		</div>
	</article>;
}
