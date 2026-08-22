import { Form, Link } from "react-router";

import type { Route } from "./+types/admin-audit";
import { Icon } from "~/components/icon";
import { auditEntityTypes, type AuditEntityType } from "~/lib/admin";
import { requireSiteAdmin } from "~/lib/auth.server";
import { listAuditEvents } from "~/models/admin.server";

export function meta() {
	return [{ title: "Audit log · State of Queer NH" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireSiteAdmin(request, context.cloudflare.env);
	const url = new URL(request.url);
	const requestedType = url.searchParams.get("type");
	const entityType = auditEntityTypes.includes(requestedType as AuditEntityType) ? requestedType as AuditEntityType : null;
	const rawPage = Number(url.searchParams.get("page") ?? "1");
	const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 1000) : 1;
	return { entityType, ...await listAuditEvents(context.cloudflare.env, { entityType, page }) };
}

function formatDateTime(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
	}).format(new Date(value));
}

function actionLabel(action: string) {
	return action.replaceAll("_", " ").replaceAll(".", " · ");
}

function pageUrl(page: number, entityType: AuditEntityType | null) {
	const search = new URLSearchParams();
	if (entityType) search.set("type", entityType);
	if (page > 1) search.set("page", String(page));
	return `/admin/audit${search.size ? `?${search}` : ""}`;
}

export default function AdminAudit({ loaderData }: Route.ComponentProps) {
	return <div className="admin-page admin-audit-page"><div className="organization-detail-actions"><Link className="back-link" to="/admin">← Operations center</Link></div><section className="page-heading"><div><p className="eyebrow">Accountability</p><h1>Audit log</h1><p>Review administrative, access, content, and moderation activity across the workspace.</p></div><span className="summary-stat"><strong>{loaderData.total}</strong><span>Recorded events</span></span></section>
		<section className="panel audit-filter-panel"><Form method="get"><label>Entity type<select defaultValue={loaderData.entityType ?? ""} name="type"><option value="">All activity</option>{auditEntityTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label><button className="button button--secondary button--compact" type="submit"><Icon name="search" size={16} /> Filter</button>{loaderData.entityType && <Link to="/admin/audit">Clear</Link>}</Form><p>Newest activity appears first.</p></section>
		<section className="panel audit-log-panel">{loaderData.events.length === 0 ? <div className="empty-state"><Icon name="activity" size={26} /><strong>No audit events match this view</strong></div> : <div className="audit-log-table"><div className="audit-log-header"><span>Activity</span><span>Entity</span><span>Actor</span><span>Time</span></div>{loaderData.events.map((event) => <article key={event.id}><div><strong>{actionLabel(event.action)}</strong><small>{event.id}</small></div><div><span className="audit-entity-pill">{event.entityType}</span><p>{event.entityLabel}</p></div><div><strong>{event.actorName || "System"}</strong><p>{event.actorEmail}</p></div><time>{formatDateTime(event.createdAt)}</time></article>)}</div>}</section>
		{loaderData.totalPages > 1 && <nav aria-label="Audit log pages" className="content-pagination">{loaderData.page > 1 && <Link className="button button--secondary" to={pageUrl(loaderData.page - 1, loaderData.entityType)}>Previous</Link>}<span>Page {loaderData.page} of {loaderData.totalPages}</span>{loaderData.page < loaderData.totalPages && <Link className="button button--secondary" to={pageUrl(loaderData.page + 1, loaderData.entityType)}>Next</Link>}</nav>}
	</div>;
}
