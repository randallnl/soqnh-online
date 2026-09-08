import type { Route } from "./+types/home";
import { Link } from "react-router";

import { Icon, type IconName } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import {
	routeSectionForDatabase,
	sectionDefinitions,
} from "~/lib/content";
import { getDashboardData } from "~/models/dashboard.server";
import { canModerateEvents } from "~/models/events.server";

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Overview · State of Queer NH" },
		{
			name: "description",
			content: "Community activity, events, projects, and ecosystem health.",
		},
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const [dashboard, eventModerator] = await Promise.all([
		getDashboardData(context.cloudflare.env, user),
		canModerateEvents(context.cloudflare.env, user),
	]);
	return { user, dashboard, eventModerator, generatedAt: new Date().toISOString() };
}

const services: Array<{
	label: string;
	status: string;
	icon: IconName;
}> = [
	{ label: "D1 database", status: "Connected", icon: "activity" },
	{ label: "R2 assets", status: "Configured", icon: "clipboard" },
	{ label: "Email sending", status: "Configured", icon: "message" },
];

const feedColors = {
	legislation: "plum",
	event: "gold",
	project: "green",
	update: "blue",
} as const;

function parseStoredTimestamp(value: string) {
	return new Date(
		/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
			? `${value.replace(" ", "T")}Z`
			: value,
	);
}

function formatDashboardDate(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		timeZone: "America/New_York",
	}).format(new Date(value));
}

function formatPostDate(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "America/New_York",
	}).format(parseStoredTimestamp(value));
}

function formatRelativeTime(value: string, relativeTo: string) {
	const elapsedMinutes = Math.max(
		0,
		Math.floor(
			(new Date(relativeTo).getTime() - parseStoredTimestamp(value).getTime()) /
				60_000,
		),
	);
	if (elapsedMinutes < 1) return "now";
	if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
	const hours = Math.floor(elapsedMinutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return days < 7 ? `${days}d` : formatPostDate(value);
}

function getEventDateParts(value: string) {
	const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	const date = local
		? new Date(
				Date.UTC(
					Number(local[1]),
					Number(local[2]) - 1,
					Number(local[3]),
					Number(local[4]),
					Number(local[5]),
				),
			)
		: new Date(value);
	const timeZone = local ? "UTC" : "America/New_York";
	return {
		month: new Intl.DateTimeFormat("en-US", {
			month: "short",
			timeZone,
		}).format(date).toUpperCase(),
		day: new Intl.DateTimeFormat("en-US", {
			day: "numeric",
			timeZone,
		}).format(date),
		time: new Intl.DateTimeFormat("en-US", {
			hour: "numeric",
			minute: "2-digit",
			timeZone,
		}).format(date),
	};
}

function excerpt(value: string) {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 150
		? `${normalized.slice(0, 147).trimEnd()}…`
		: normalized;
}

function initials(name: string | null) {
	return (name || "Member")
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0])
		.join("")
		.toUpperCase();
}

export default function Home({ loaderData }: Route.ComponentProps) {
	const { dashboard } = loaderData;
	const stats: Array<{
		label: string;
		value: number;
		note: string;
		icon: IconName;
		color: string;
		to: string;
	}> = [
		{
			label: "Active members",
			value: dashboard.counts.activeMembers,
			note: "Visible in your network",
			icon: "people",
			color: "green",
			to: "/members",
		},
		{
			label: "Organizations",
			value: dashboard.counts.organizations,
			note: "Visible in your network",
			icon: "building",
			color: "blue",
			to: "/organizations",
		},
		{
			label: "Upcoming events",
			value: dashboard.counts.upcomingEvents,
			note: "Visible to you",
			icon: "calendar",
			color: "gold",
			to: "/events",
		},
		{
			label: "Pending review",
			value: dashboard.counts.pendingEvents,
			note: "Events you can moderate",
			icon: "clipboard",
			color: "plum",
			to: loaderData.eventModerator ? "/events/moderation" : "/events",
		},
	];

	return (
		<div className="dashboard-page">
			<section className="page-heading dashboard-heading">
				<div>
					<div className="heading-kicker">
						<p className="eyebrow">{formatDashboardDate(loaderData.generatedAt)}</p>
						<span className="data-mode data-mode--live">
							<span />
							Live network data
						</span>
					</div>
					<h1>Welcome back, {loaderData.user.name?.split(/\s+/)[0] || "friend"}.</h1>
					<p>Here’s what’s happening across the ecosystem.</p>
				</div>
				<Link className="button button--secondary heading-action" to="/events">
					<Icon name="calendar" size={17} />
					View calendar
				</Link>
			</section>

			<section aria-label="Ecosystem summary" className="stat-grid">
				{stats.map((stat) => (
					<Link className="stat-card" key={stat.label} to={stat.to}>
						<span className={`stat-icon stat-icon--${stat.color}`}>
							<Icon name={stat.icon} size={21} />
						</span>
						<div className="stat-copy">
							<strong>{stat.value}</strong>
							<p>{stat.label}</p>
							<small>{stat.note}</small>
						</div>
						<Icon className="stat-card-arrow" name="chevron-right" size={17} />
					</Link>
				))}
			</section>

			<div className="dashboard-columns">
				<div className="dashboard-primary">
					<section className="panel feed-panel">
						<div className="panel-heading">
							<div>
								<p className="eyebrow">Community pulse</p>
								<h2>Latest across the ecosystem</h2>
							</div>
							<Link to="/updates">See Community Feed</Link>
						</div>
						{dashboard.recentPosts.length === 0 ? (
							<div className="empty-state empty-state--compact dashboard-empty-state">
								<Icon name="message" size={25} />
								<strong>No published activity yet</strong>
								<p>New posts visible to you will appear here.</p>
							</div>
						) : (
							<div className="feed-list">
								{dashboard.recentPosts.map((post) => {
									const routeSection = routeSectionForDatabase(post.section);
									const section = sectionDefinitions[routeSection];
									return (
										<article className="feed-item" key={post.id}>
											<span className={`feed-icon feed-icon--${feedColors[post.section]}`}>
												<Icon name={section.icon} size={20} />
											</span>
											<div>
												<p className="feed-type">{section.title}</p>
												<h3><Link to={`/posts/${post.id}`}>{post.title}</Link></h3>
												<p>{excerpt(post.body)}</p>
												<small>
													{post.organizationName || "Ecosystem-wide"} · {formatPostDate(post.createdAt)} · {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
												</small>
											</div>
											<Link aria-label={`Open ${post.title}`} className="icon-button subtle-button" to={`/posts/${post.id}`}>
												<Icon name="chevron-right" size={18} />
											</Link>
										</article>
									);
								})}
							</div>
						)}
					</section>

					{loaderData.user.siteRole === "site_admin" && (
						<section className="panel service-panel">
							<div className="panel-heading">
								<div>
									<p className="eyebrow">Foundation status</p>
									<h2>Cloudflare services</h2>
								</div>
								<a href="/health">Open health check</a>
							</div>
							<div className="service-grid">
								{services.map((service) => (
									<div className="service-item" key={service.label}>
										<span><Icon name={service.icon} size={18} /></span>
										<div><strong>{service.label}</strong><small>{service.status}</small></div>
										<i aria-label="Ready" />
									</div>
								))}
							</div>
						</section>
					)}
				</div>

				<aside className="dashboard-secondary">
					<section className="panel compact-panel">
						<div className="panel-heading">
							<h2>Upcoming events</h2>
							<Link to="/events">View all</Link>
						</div>
						{dashboard.upcomingEvents.length === 0 ? (
							<div className="empty-state empty-state--compact dashboard-empty-state">
								<Icon name="calendar" size={24} />
								<strong>No upcoming events</strong>
							</div>
						) : (
							<div className="event-list">
								{dashboard.upcomingEvents.map((event) => {
									const date = getEventDateParts(event.startsAt);
									return (
										<article className="event-row" key={event.postId}>
											<time dateTime={event.startsAt}>
												<span>{date.month}</span>
												<strong>{date.day}</strong>
											</time>
											<div>
												<h3><Link to={`/posts/${event.postId}`}>{event.title}</Link></h3>
												<p>{date.time}{event.locationName ? ` · ${event.locationName}` : ""}</p>
											</div>
										</article>
									);
								})}
							</div>
						)}
					</section>

					<section className="panel compact-panel">
						<div className="panel-heading">
							<h2>Recent activity</h2>
							<Link to="/notifications">See all</Link>
						</div>
						{dashboard.recentActivity.length === 0 ? (
							<div className="empty-state empty-state--compact dashboard-empty-state">
								<Icon name="activity" size={24} />
								<strong>No recent comments</strong>
							</div>
						) : (
							<div className="activity-list">
								{dashboard.recentActivity.map((item, index) => (
									<article className="activity-row" key={item.commentId}>
										<span className={`mini-avatar mini-avatar--${["violet", "blue", "rose"][index % 3]}`}>{initials(item.authorName)}</span>
										<p><strong>{item.authorName || "Member"}</strong> commented on <Link to={`/posts/${item.postId}#comment-${item.commentId}`}>{item.postTitle}</Link></p>
										<time dateTime={item.createdAt}>{formatRelativeTime(item.createdAt, loaderData.generatedAt)}</time>
									</article>
								))}
							</div>
						)}
					</section>
				</aside>
			</div>
		</div>
	);
}
