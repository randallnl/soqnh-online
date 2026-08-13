import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/event-moderation";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { formatEventDateTime } from "~/lib/events";
import { requireSameOrigin } from "~/lib/http.server";
import { canModerateEvents, EventMutationError, listPendingEvents, reviewEvent } from "~/models/events.server";

const reviewSchema = z.object({
	postId: z.string().uuid(),
	decision: z.enum(["approve", "reject"]),
	reason: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : null,
		z.string().max(500).nullable(),
	),
}).refine((value) => value.decision !== "reject" || Boolean(value.reason), {
	message: "Explain what needs to change before rejecting the event",
	path: ["reason"],
});

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	if (!await canModerateEvents(context.cloudflare.env, user)) throw new Response("Forbidden", { status: 403 });
	return { events: await listPendingEvents(context.cloudflare.env, user) };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = reviewSchema.safeParse(Object.fromEntries(await request.formData()));
	if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the review decision" };
	try {
		await reviewEvent(context.cloudflare.env, user, result.data);
		throw redirect("/events/moderation");
	} catch (error) {
		if (error instanceof Response) throw error;
		if (error instanceof EventMutationError) {
			const messages = { "not-found": "That event is no longer available.", forbidden: "You cannot moderate that event.", "already-reviewed": "Another moderator already reviewed that event." };
			return { ok: false as const, error: messages[error.reason] };
		}
		return { ok: false as const, error: "The event review could not be saved." };
	}
}

export function meta() {
	return [{ title: "Event moderation · State of Queer NH" }];
}

export default function EventModeration({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	return <div className="section-page event-moderation-page"><div className="organization-detail-actions"><Link className="back-link" to="/events">← Events</Link></div><section className="page-heading"><div><p className="eyebrow">Event operations</p><h1>Event moderation</h1><p>Review submitted event details before they become visible to members.</p></div><span className="summary-stat"><strong>{loaderData.events.length}</strong><span>Pending</span></span></section>{actionData && !actionData.ok && <p className="form-message form-message--error">{actionData.error}</p>}{loaderData.events.length === 0 ? <section className="panel empty-state"><Icon name="calendar" size={28} /><strong>The queue is clear</strong><p>New and revised events will appear here for approval.</p></section> : <section className="moderation-list" aria-label="Pending events">{loaderData.events.map((event) => <article className="panel moderation-card" key={event.postId}>{event.imageUrl && <img alt="" className="event-card-image" referrerPolicy="no-referrer" src={event.imageUrl} />}<div className="moderation-card-body"><div className="event-date-line"><Icon name="calendar" size={17} /><strong>{formatEventDateTime(event.startsAt)}</strong>{event.endsAt && <span>to {formatEventDateTime(event.endsAt)}</span>}</div><h2><Link to={`/posts/${event.postId}`}>{event.title}</Link></h2><p>{event.body}</p><div className="content-card-meta"><span>{event.organizationName || "Ecosystem-wide"}</span><span>Submitted by {event.authorName || "Member"}</span>{event.locationName && <span>{event.locationName}</span>}</div><div className="moderation-actions"><Form method="post"><input name="postId" type="hidden" value={event.postId} /><input name="decision" type="hidden" value="approve" /><button className="button button--primary" disabled={navigation.state === "submitting"} type="submit">Approve and publish</button></Form><Form className="event-reject-form" method="post"><input name="postId" type="hidden" value={event.postId} /><input name="decision" type="hidden" value="reject" /><label>Changes needed<input maxLength={500} name="reason" placeholder="Give the author a clear next step" required /></label><button className="member-action-button member-action-button--suspend" disabled={navigation.state === "submitting"} type="submit">Reject</button></Form></div></div></article>)}</section>}</div>;
}
