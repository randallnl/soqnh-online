import { Link } from "react-router";

import type { Route } from "./+types/public-calendar";
import { Icon } from "~/components/icon";
import { initials } from "~/lib/media";
import { listPublishedCalendarEvents } from "~/models/public-directory.server";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
	const firstWeekday = monthDate.getUTCDay();
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
	const eventsByDay = new Map<number, typeof loaderData.events>();
	for (const event of loaderData.events) {
		const day = Number(event.startsAt.slice(8, 10));
		if (!Number.isInteger(day) || day < 1 || day > daysInMonth) continue;
		eventsByDay.set(day, [...(eventsByDay.get(day) ?? []), event]);
	}

	return <div className="public-calendar-page">
		<section className="public-calendar-heading">
			<div><p className="eyebrow">Community calendar</p><h1>Gather across New Hampshire.</h1><p>Explore public events shared by organizations participating in the NH Connect directory.</p></div>
			<Link className="button button--secondary" to="/">Browse organizations</Link>
		</section>

		<section aria-labelledby="calendar-month-heading" className="public-calendar-panel">
			<header className="public-calendar-toolbar">
				<Link aria-label="Previous month" className="public-calendar-arrow" to={`/calendar?month=${shiftMonth(loaderData.selectedMonth, -1)}`}>←</Link>
				<div><p>{loaderData.events.length} {loaderData.events.length === 1 ? "event" : "events"}</p><h2 id="calendar-month-heading">{monthLabel}</h2></div>
				<Link aria-label="Next month" className="public-calendar-arrow" to={`/calendar?month=${shiftMonth(loaderData.selectedMonth, 1)}`}>→</Link>
			</header>

			<div aria-hidden="true" className="public-calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 3)}</span>)}</div>
			<div className="public-calendar-grid">
				{Array.from({ length: cellCount }, (_, index) => {
					const day = index - firstWeekday + 1;
					if (day < 1 || day > daysInMonth) return <div aria-hidden="true" className="public-calendar-day public-calendar-day--outside" key={`outside-${index}`} />;
					const events = eventsByDay.get(day) ?? [];
					const fullDate = new Date(Date.UTC(year, month - 1, day));
					const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(fullDate);
					return <section aria-label={dayLabel} className={`public-calendar-day${events.length ? " public-calendar-day--has-events" : ""}`} key={day}>
						<header><span>{WEEKDAYS[fullDate.getUTCDay()].slice(0, 3)}</span><strong>{day}</strong></header>
						{events.map((event) => {
							const eventUrl = safeHttpUrl(event.registrationUrl) || safeHttpUrl(event.externalUrl) || safeHttpUrl(event.sourceUrl);
							return <article className="public-calendar-event" key={`${event.organizationSlug}-${event.startsAt}-${event.title}`}>
								<div className="public-calendar-event-time">{eventTime(event.startsAt)}</div>
								{eventUrl ? <a href={eventUrl} rel="noopener noreferrer" target="_blank">{event.title}</a> : <strong>{event.title}</strong>}
								{event.locationName && <p><Icon name="building" size={12} /> {event.locationName}</p>}
								<Link className="public-calendar-organizer" to={`/directory/${encodeURIComponent(event.organizationSlug)}`}>
									<span>{event.organizationHasLogo ? <img alt="" loading="lazy" src={`/directory/${encodeURIComponent(event.organizationSlug)}/media/logo`} /> : initials(event.organizationName, "Organization")}</span>
									{event.organizationName}
								</Link>
							</article>;
						})}
					</section>;
				})}
			</div>
			{loaderData.events.length === 0 && <div className="public-calendar-empty"><Icon name="calendar" size={27} /><strong>No public events this month</strong><p>Try the next month, or check back as participating organizations add events.</p></div>}
		</section>
	</div>;
}
