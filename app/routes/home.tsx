import type { Route } from "./+types/home";
import { Link } from "react-router";

import { Icon, type IconName } from "~/components/icon";
import { getDashboardCounts } from "~/models/dashboard.server";

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Overview · State of Queer NH" },
		{
			name: "description",
			content: "Community activity, events, projects, and ecosystem health.",
		},
	];
}

export async function loader({ context }: Route.LoaderArgs) {
	const counts = await getDashboardCounts(context.cloudflare.env.DB);
	return {
		counts:
			counts ??
			{
				activeMembers: 248,
				organizations: 36,
				pendingEvents: 7,
				upcomingEvents: 12,
			},
		dataMode: counts ? ("live" as const) : ("preview" as const),
	};
}

const updates: Array<{
	type: string;
	title: string;
	copy: string;
	meta: string;
	icon: IconName;
	color: string;
}> = [
	{
		type: "Legislation",
		title: "Policy working group shared a new briefing",
		copy: "A plain-language summary is ready for member review before the next coordination call.",
		meta: "2 hours ago · 6 comments",
		icon: "gavel",
		color: "plum",
	},
	{
		type: "Community event",
		title: "Regional organizer meetup",
		copy: "An evening for introductions, shared learning, and making the next round of connections.",
		meta: "Tomorrow at 6:00 PM · Concord",
		icon: "calendar",
		color: "gold",
	},
	{
		type: "Project",
		title: "Resource guide refresh is underway",
		copy: "Three partner organizations joined the working group and divided up the first review pass.",
		meta: "Yesterday · 9 collaborators",
		icon: "clipboard",
		color: "green",
	},
];

const upcomingEvents = [
	{
		month: "AUG",
		day: "14",
		title: "Community care training",
		detail: "5:30 PM · Manchester",
	},
	{
		month: "AUG",
		day: "19",
		title: "Policy roundtable",
		detail: "12:00 PM · Virtual",
	},
	{
		month: "AUG",
		day: "24",
		title: "Queer makers meetup",
		detail: "3:00 PM · Keene",
	},
];

const recentActivity = [
	{
		initials: "MK",
		name: "Morgan K.",
		copy: "commented on a policy briefing",
		time: "18m",
		color: "violet",
	},
	{
		initials: "OR",
		name: "Outright NH",
		copy: "published a community update",
		time: "1h",
		color: "blue",
	},
	{
		initials: "JL",
		name: "Jordan L.",
		copy: "joined the resource guide project",
		time: "3h",
		color: "rose",
	},
];

const services: Array<{
	label: string;
	status: string;
	icon: IconName;
}> = [
	{ label: "D1 database", status: "Connected", icon: "activity" },
	{ label: "R2 assets", status: "Configured", icon: "clipboard" },
	{ label: "Email sending", status: "Configured", icon: "message" },
];

export default function Home({ loaderData }: Route.ComponentProps) {
	const stats: Array<{
		label: string;
		value: number;
		note: string;
		icon: IconName;
		color: string;
	}> = [
		{
			label: "Active members",
			value: loaderData.counts.activeMembers,
			note: "People in the network",
			icon: "people",
			color: "green",
		},
		{
			label: "Organizations",
			value: loaderData.counts.organizations,
			note: "Partners and coalitions",
			icon: "building",
			color: "blue",
		},
		{
			label: "Upcoming events",
			value: loaderData.counts.upcomingEvents,
			note: "Across New Hampshire",
			icon: "calendar",
			color: "gold",
		},
		{
			label: "Pending review",
			value: loaderData.counts.pendingEvents,
			note: "Events need attention",
			icon: "clipboard",
			color: "plum",
		},
	];

	return (
		<div className="dashboard-page">
			<section className="page-heading dashboard-heading">
				<div>
					<div className="heading-kicker">
						<p className="eyebrow">Monday, August 10</p>
						<span className={`data-mode data-mode--${loaderData.dataMode}`}>
							<span />
							{loaderData.dataMode === "live" ? "Live D1 data" : "Preview data"}
						</span>
					</div>
					<h1>Good afternoon, Randall.</h1>
					<p>Here’s what’s happening across the ecosystem today.</p>
				</div>
				<Link className="button button--secondary heading-action" to="/events">
					<Icon name="calendar" size={17} />
					View calendar
				</Link>
			</section>

			<section aria-label="Ecosystem summary" className="stat-grid">
				{stats.map((stat) => (
					<article className="stat-card" key={stat.label}>
						<span className={`stat-icon stat-icon--${stat.color}`}>
							<Icon name={stat.icon} size={21} />
						</span>
						<div className="stat-copy">
							<strong>{stat.value}</strong>
							<p>{stat.label}</p>
							<small>{stat.note}</small>
						</div>
					</article>
				))}
			</section>

			<div className="dashboard-columns">
				<div className="dashboard-primary">
					<section className="panel feed-panel">
						<div className="panel-heading">
							<div>
								<p className="eyebrow">Community pulse</p>
								<h2>This week in the ecosystem</h2>
							</div>
							<Link to="/updates">See all updates</Link>
						</div>
						<div className="feed-list">
							{updates.map((update) => (
								<article className="feed-item" key={update.title}>
									<span className={`feed-icon feed-icon--${update.color}`}>
										<Icon name={update.icon} size={20} />
									</span>
									<div>
										<p className="feed-type">{update.type}</p>
										<h3>{update.title}</h3>
										<p>{update.copy}</p>
										<small>{update.meta}</small>
									</div>
									<button aria-label={`Open ${update.title}`} className="icon-button subtle-button" type="button">
										<Icon name="chevron-right" size={18} />
									</button>
								</article>
							))}
						</div>
					</section>

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
				</div>

				<aside className="dashboard-secondary">
					<section className="panel compact-panel">
						<div className="panel-heading">
							<h2>Upcoming events</h2>
							<Link to="/events">View all</Link>
						</div>
						<div className="event-list">
							{upcomingEvents.map((event) => (
								<article className="event-row" key={event.title}>
									<time>
										<span>{event.month}</span>
										<strong>{event.day}</strong>
									</time>
									<div>
										<h3>{event.title}</h3>
										<p>{event.detail}</p>
									</div>
								</article>
							))}
						</div>
					</section>

					<section className="panel compact-panel">
						<div className="panel-heading">
							<h2>Recent activity</h2>
							<Link to="/notifications">See all</Link>
						</div>
						<div className="activity-list">
							{recentActivity.map((item) => (
								<article className="activity-row" key={`${item.name}-${item.time}`}>
									<span className={`mini-avatar mini-avatar--${item.color}`}>{item.initials}</span>
									<p><strong>{item.name}</strong> {item.copy}</p>
									<time>{item.time}</time>
								</article>
							))}
						</div>
					</section>
				</aside>
			</div>
		</div>
	);
}
