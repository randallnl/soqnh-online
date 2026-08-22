import { Link } from "react-router";

import type { Route } from "./+types/admin";
import { Icon, type IconName } from "~/components/icon";
import { requireSiteAdmin } from "~/lib/auth.server";
import { getAdminOperationsData } from "~/models/admin.server";

export function meta() {
	return [{ title: "Administration · State of Queer NH" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	return { admin, ...await getAdminOperationsData(context.cloudflare.env) };
}

function formatDateTime(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
		timeZone: "America/New_York",
	}).format(new Date(value));
}

function actionLabel(action: string) {
	return action.replaceAll("_", " ").replaceAll(".", " · ");
}

export default function AdminOperations({ loaderData }: Route.ComponentProps) {
	const { metrics, latestScraperRun } = loaderData;
	const attentionCount = metrics.pendingEvents + metrics.invitedMembers + metrics.suspendedMembers + metrics.organizationsWithoutAffiliations + (latestScraperRun?.status === "failed" ? 1 : 0);
	const tools: Array<{ title: string; copy: string; to: string; icon: IconName; count?: number; tone: string }> = [
		{ title: "Member access", copy: `${metrics.activeMembers} active · ${metrics.suspendedMembers} suspended`, to: "/admin/members", icon: "people", count: metrics.suspendedMembers, tone: "green" },
		{ title: "Invitations", copy: `${metrics.activeInvitations} active invitations`, to: "/admin/invitations", icon: "user", count: metrics.invitedMembers, tone: "blue" },
		{ title: "Organizations", copy: `${metrics.activeOrganizations} active organizations`, to: "/admin/organizations", icon: "building", count: metrics.organizationsWithoutAffiliations, tone: "gold" },
		{ title: "Affiliations", copy: `${metrics.affiliations} networks controlling visibility`, to: "/admin/affiliations", icon: "activity", tone: "plum" },
		{ title: "Event moderation", copy: `${metrics.pendingEvents} events awaiting review`, to: "/events/moderation", icon: "calendar", count: metrics.pendingEvents, tone: "gold" },
		{ title: "Event scraper", copy: `${metrics.enabledScraperSources} enabled partner sources`, to: "/admin/scraper", icon: "sparkles", count: latestScraperRun?.status === "failed" ? 1 : 0, tone: "blue" },
	];
	return <div className="admin-page admin-operations-page">
		<section className="page-heading"><div><p className="eyebrow">Site administration</p><h1>Operations center</h1><p>Run the member network, resolve pending work, and inspect system activity from one place.</p></div><Link className="button button--secondary heading-action" to="/admin/audit"><Icon name="activity" size={17} /> View audit log</Link></section>

		<section className="admin-operations-summary" aria-label="Operations summary">
			<div className="panel admin-health-card"><span className={`admin-health-indicator${attentionCount ? " admin-health-indicator--attention" : ""}`}><Icon name={attentionCount ? "bell" : "activity"} size={22} /></span><div><p className="eyebrow">Operational status</p><strong>{attentionCount ? `${attentionCount} items need attention` : "All queues are clear"}</strong><p>{attentionCount ? "Open the relevant workspace below to take action." : "No moderation, access, affiliation, or scraper issues are waiting."}</p></div></div>
			<div className="panel admin-content-card"><p className="eyebrow">Published content</p><strong>{metrics.publishedPosts}</strong><span>{metrics.draftPosts} drafts in progress</span></div>
			<div className="panel admin-scraper-health"><p className="eyebrow">Latest scraper run</p>{latestScraperRun ? <><strong className={`scraper-health scraper-health--${latestScraperRun.status}`}>{latestScraperRun.status}</strong><span>{formatDateTime(latestScraperRun.startedAt)} · {latestScraperRun.importedCount} imported</span>{latestScraperRun.errorMessage && <small>{latestScraperRun.errorMessage}</small>}</> : <><strong>Not run yet</strong><span>No execution history recorded</span></>}</div>
		</section>

		<section className="admin-tool-grid" aria-label="Administration tools">{tools.map((tool) => <Link className="panel admin-tool-card" key={tool.to} to={tool.to}><span className={`section-hero-icon section-hero-icon--${tool.tone}`}><Icon name={tool.icon} size={21} /></span><div><h2>{tool.title}</h2><p>{tool.copy}</p></div>{Boolean(tool.count) && <span className="admin-tool-count">{tool.count}</span>}<Icon className="admin-tool-arrow" name="chevron-right" size={18} /></Link>)}</section>

		<section className="panel admin-audit-preview"><div className="panel-heading"><div><p className="eyebrow">Accountability</p><h2>Recent activity</h2></div><Link to="/admin/audit">View all activity</Link></div>{loaderData.recentAuditEvents.length === 0 ? <p className="muted-empty admin-audit-empty">No audit activity recorded yet.</p> : <div className="admin-audit-list">{loaderData.recentAuditEvents.map((event) => <article key={event.id}><span className="admin-audit-dot" /><div><strong>{event.actorName || event.actorEmail || "System"}</strong><p>{actionLabel(event.action)} · {event.entityLabel}</p></div><time>{formatDateTime(event.createdAt)}</time></article>)}</div>}</section>
	</div>;
}
