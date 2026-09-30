import { Link } from "react-router";

import type { Route } from "./+types/public-calendar";
import { Icon } from "~/components/icon";
import { initials } from "~/lib/media";
import { listPublishedCalendarEvents } from "~/models/public-directory.server";

function monthValue(date = new Date()) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		timeZone: "America/New_York",
	}).formatToParts(date);
	const value = (type: "year" | "month") => parts.find((part) => part.type === type)?.value ?? "";
	return `${value("year")}-${value("month")}`;
}

function parseMonth(value: string | null) {
	const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
	if (!match) return monthValue();
	const year = Number(match[1]);
	const month = Number(match[2]);
	return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : monthValue();
}

function shiftMonth(value: string, amount: number) {
	const [year, month] = value.split("-").map(Number);
	const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
	return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
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

function eventTime(value: string) {
	if (/T00:00(?::00)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)) return "Time not listed";
	const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	const date = local
		? new Date(Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5])))
		: new Date(value);
	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		minute: "2-digit",
		timeZone: local ? "UTC" : "America/New_York",
	}).format(date);
}

function eventDateParts(value: string) {
	const local = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	const date = local
		? new Date(Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3])))
		: new Date(value);
	const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: local ? "UTC" : "America/New_York" }).format(date);
	return {
		month: format({ month: "short" }),
		day: format({ day: "numeric" }),
		weekday: format({ weekday: "short" }),
	};
}

export function meta() {
	return [
		{ title: "Community Calendar · NH Connect" },
		{ name: "description", content: "Discover public events from organizations participating in the NH Connect community directory." },
	];
}

export function headers() {
	return { "Cache-Control": "no-store" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const selectedMonth = parseMonth(new URL(request.url).searchParams.get("month"));
	const nextMonth = shiftMonth(selectedMonth, 1);
	const events = await listPublishedCalendarEvents(
		context.cloudflare.env,
		`${selectedMonth}-01`,
		`${nextMonth}-01`,
	);
	return { selectedMonth, events };
}

export default function PublicCalendar({ loaderData }: Route.ComponentProps) {
	const [year, month] = loaderData.selectedMonth.split("-").map(Number);
	const monthDate = new Date(Date.UTC(year, month - 1, 1));
	const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthDate);

	return <div className="public-calendar-page">
		<section className="public-calendar-heading">
			<div><p className="eyebrow">Community Calendar</p><h1>Gather across New Hampshire.</h1><p>Browse a chronological feed of public events shared by organizations participating in NH Connect.</p></div>
			<Link className="button button--secondary" to="/directory">Browse organizations</Link>
		</section>

		<section aria-labelledby="calendar-month-heading" className="public-calendar-panel">
			<header className="public-calendar-toolbar">
				<Link aria-label="Previous month" className="public-calendar-arrow" to={`/calendar?month=${shiftMonth(loaderData.selectedMonth, -1)}`}>←</Link>
				<div><p>{loaderData.events.length} {loaderData.events.length === 1 ? "event" : "events"}</p><h2 id="calendar-month-heading">{monthLabel}</h2></div>
				<Link aria-label="Next month" className="public-calendar-arrow" to={`/calendar?month=${shiftMonth(loaderData.selectedMonth, 1)}`}>→</Link>
			</header>

			{loaderData.events.length > 0 && <div className="public-calendar-feed">{loaderData.events.map((event) => {
				const eventUrl = safeHttpUrl(event.registrationUrl) || safeHttpUrl(event.externalUrl) || safeHttpUrl(event.sourceUrl);
				const imageUrl = safeHttpUrl(event.imageUrl);
				const date = eventDateParts(event.startsAt);
				return <article className="public-calendar-feed-card" key={`${event.organizationSlug}-${event.startsAt}-${event.title}`}>
					<div className="public-calendar-feed-image">{imageUrl ? <img alt="" loading="lazy" referrerPolicy="no-referrer" src={imageUrl} /> : <Icon name="calendar" size={34} />}</div>
					<div aria-label={`${date.weekday}, ${date.month} ${date.day}`} className="public-calendar-feed-date"><span>{date.month}</span><strong>{date.day}</strong><small>{date.weekday}</small></div>
					<div className="public-calendar-feed-body">
						<p className="public-calendar-event-time">{eventTime(event.startsAt)}</p>
						<h3>{eventUrl ? <a href={eventUrl} rel="noopener noreferrer" target="_blank">{event.title}</a> : event.title}</h3>
						{event.locationName && <p className="public-calendar-feed-location"><Icon name="building" size={15} /> {event.locationName}</p>}
						<div className="public-calendar-feed-footer">
							<Link className="public-calendar-organizer" to={`/directory/${encodeURIComponent(event.organizationSlug)}`}><span>{event.organizationHasLogo ? <img alt="" loading="lazy" src={`/directory/${encodeURIComponent(event.organizationSlug)}/media/logo`} /> : initials(event.organizationName, "Organization")}</span><span><small>Hosted by</small>{event.organizationName}</span></Link>
							{eventUrl && <a className="public-calendar-feed-action" href={eventUrl} rel="noopener noreferrer" target="_blank">View event <Icon name="chevron-right" size={15} /></a>}
						</div>
					</div>
				</article>;
			})}</div>}
			{loaderData.events.length === 0 && <div className="public-calendar-empty"><Icon name="calendar" size={27} /><strong>No public events this month</strong><p>Try the next month, or check back as participating organizations add events.</p></div>}
		</section>
	</div>;
}
