import { Link } from "react-router";

import type { Route } from "./+types/public-home";
import { Icon } from "~/components/icon";
import { initials } from "~/lib/media";
import { organizationCategoryTone, parseOrganizationCategories } from "~/lib/organization-categories";
import { listPublishedOrganizations, listPublishedUpcomingCalendarEvents } from "~/models/public-directory.server";

function todayInNewHampshire() {
	const parts = new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		timeZone: "America/New_York",
	}).formatToParts(new Date());
	const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
	return `${value("year")}-${value("month")}-${value("day")}`;
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

function formatEventDateTime(value: string) {
	const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	const date = local
		? new Date(Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5])))
		: new Date(value);
	return new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZone: local ? "UTC" : "America/New_York",
	}).format(date);
}

export function meta() {
	return [
		{ title: "NH Connect · Find community across New Hampshire" },
		{ name: "description", content: "Explore affirming organizations and community events across New Hampshire through Queerlective's NH Connect." },
	];
}

export function headers() {
	return { "Cache-Control": "no-store" };
}

export async function loader({ context }: Route.LoaderArgs) {
	const [organizations, upcomingEvents] = await Promise.all([
		listPublishedOrganizations(context.cloudflare.env),
		listPublishedUpcomingCalendarEvents(context.cloudflare.env, todayInNewHampshire()),
	]);
	return {
		organizationCount: organizations.length,
		organizations: organizations.slice(0, 3),
		upcomingEvents,
	};
}

export default function PublicHome({ loaderData }: Route.ComponentProps) {
	return <>
		<section className="public-directory-hero public-home-hero">
			<div className="public-directory-hero-copy">
				<p className="eyebrow">NH Connect by Queerlective</p>
				<h1>Find community. Share space. Stay connected.</h1>
				<p>Discover affirming organizations, businesses, resources, and gatherings across New Hampshire—all in one community-maintained place.</p>
				<div className="public-home-hero-actions">
					<Link className="button button--primary" to="/directory">Explore the directory</Link>
					<Link className="button public-home-hero-secondary" to="/calendar">View community events</Link>
				</div>
			</div>
			<div className="public-directory-hero-note"><Icon name="heart" size={24} /><div><strong>Built with community</strong><p>Organizations choose to participate and keep their public information current.</p></div></div>
			<p className="public-directory-photo-credit">Photo by Steven Hamilton</p>
		</section>

		<div className="public-home-content">
			<section aria-label="Explore NH Connect" className="public-home-paths">
				<Link to="/directory"><span className="public-home-path-icon"><Icon name="building" size={25} /></span><div><p className="eyebrow">Public directory</p><h2>Find people doing the work</h2><p>Explore {loaderData.organizationCount} participating {loaderData.organizationCount === 1 ? "organization" : "organizations"}, businesses, services, and community spaces.</p><strong>Browse the directory <Icon name="chevron-right" size={16} /></strong></div></Link>
				<Link to="/calendar"><span className="public-home-path-icon public-home-path-icon--calendar"><Icon name="calendar" size={25} /></span><div><p className="eyebrow">Community calendar</p><h2>See what is happening next</h2><p>Find public events shared by participating organizations from around New Hampshire.</p><strong>Open the calendar <Icon name="chevron-right" size={16} /></strong></div></Link>
			</section>

			{loaderData.upcomingEvents.length > 0 && <section className="public-home-section">
				<header><div><p className="eyebrow">Coming up</p><h2>Gather with community</h2></div><Link to="/calendar">View the Community Calendar <Icon name="chevron-right" size={16} /></Link></header>
				<div className="public-home-event-grid">{loaderData.upcomingEvents.map((event) => {
					const eventUrl = safeHttpUrl(event.registrationUrl) || safeHttpUrl(event.externalUrl) || safeHttpUrl(event.sourceUrl);
					const imageUrl = safeHttpUrl(event.imageUrl);
					const contents = <>
						<div className="public-upcoming-event-image">{imageUrl ? <img alt="" loading="lazy" referrerPolicy="no-referrer" src={imageUrl} /> : <Icon name="calendar" size={28} />}</div>
						<div className="public-upcoming-event-body"><p>{formatEventDateTime(event.startsAt)}</p><h3>{event.title}</h3><span className="public-home-event-host"><span>{event.organizationHasLogo ? <img alt="" loading="lazy" src={`/directory/${encodeURIComponent(event.organizationSlug)}/media/logo`} /> : initials(event.organizationName, "Organization")}</span>{event.organizationName}</span>{eventUrl && <strong>View event <Icon name="chevron-right" size={15} /></strong>}</div>
					</>;
					return eventUrl
						? <a className="public-upcoming-event-card" href={eventUrl} key={`${event.organizationSlug}-${event.startsAt}-${event.title}`} rel="noopener noreferrer" target="_blank">{contents}</a>
						: <article className="public-upcoming-event-card" key={`${event.organizationSlug}-${event.startsAt}-${event.title}`}>{contents}</article>;
				})}</div>
			</section>}

			{loaderData.organizations.length > 0 && <section className="public-home-section">
				<header><div><p className="eyebrow">From the directory</p><h2>Meet participating organizations</h2></div><Link to="/directory">Explore all organizations <Icon name="chevron-right" size={16} /></Link></header>
				<div className="public-directory-grid public-home-organization-grid">{loaderData.organizations.map((organization) => {
					const categories = parseOrganizationCategories(organization.category);
					return <Link className="public-directory-card" key={organization.slug} to={`/directory/${organization.slug}`}>
						<div className={`public-directory-card-cover${organization.hasProfilePhoto ? " public-directory-card-cover--photo" : ""}`}>{organization.hasProfilePhoto && <img alt="" loading="lazy" src={`/directory/${encodeURIComponent(organization.slug)}/media/photo`} />}</div>
						<div className="public-directory-card-body"><span className="public-directory-logo">{organization.hasLogo ? <img alt="" loading="lazy" src={`/directory/${encodeURIComponent(organization.slug)}/media/logo`} /> : initials(organization.name, "Organization")}</span><h3>{organization.name}</h3><p>{organization.summary || "An affirming organization in New Hampshire’s community ecosystem."}</p>{categories.length > 0 && <div className="public-directory-tags">{categories.slice(0, 3).map((category) => <span className={`organization-category-chip organization-category-tone--${organizationCategoryTone(category)}`} key={category}>{category}</span>)}</div>}</div>
						<footer><span>{organization.operatesStatewide === 1 ? "Statewide" : [organization.townCity, organization.region].filter(Boolean).join(" · ") || "New Hampshire"}</span><span>View profile <Icon name="chevron-right" size={16} /></span></footer>
					</Link>;
				})}</div>
			</section>}
		</div>
	</>;
}
