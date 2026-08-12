import { Form, Link, redirect, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/notifications";
import { Icon } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { countUnreadNotifications, listNotifications, markAllNotificationsRead, markNotificationRead } from "~/models/notifications.server";

const actionSchema = z.discriminatedUnion("intent", [
	z.object({ intent: z.literal("mark-one-read"), notificationId: z.string().uuid() }),
	z.object({ intent: z.literal("mark-all-read") }),
]);

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const [notifications, unreadCount] = await Promise.all([
		listNotifications(context.cloudflare.env, user),
		countUnreadNotifications(context.cloudflare.env, user),
	]);
	return { notifications, unreadCount };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = actionSchema.safeParse(Object.fromEntries(await request.formData()));
	if (!result.success) return { ok: false as const, error: "That notification request is invalid." };
	if (result.data.intent === "mark-all-read") {
		await markAllNotificationsRead(context.cloudflare.env, user.id);
		return { ok: true as const };
	}
	const notification = await markNotificationRead(context.cloudflare.env, user.id, result.data.notificationId);
	if (!notification?.postId) return { ok: false as const, error: "That notification is no longer available." };
	throw redirect(`/posts/${notification.postId}${notification.commentId ? `#comment-${notification.commentId}` : ""}`);
}

export function meta() {
	return [{ title: "Notifications · State of Queer NH" }];
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
	const navigation = useNavigation();
	return <div className="notifications-page">
		<section className="page-heading notifications-heading"><div><p className="eyebrow">Stay connected</p><h1>Notifications</h1><p>Mentions, replies, and activity on your posts appear here.</p></div>{loaderData.unreadCount > 0 && <Form method="post"><input name="intent" type="hidden" value="mark-all-read" /><button className="button button--secondary" disabled={navigation.state === "submitting"} type="submit">Mark all read</button></Form>}</section>
		<section className="panel notification-inbox">
			{loaderData.notifications.length === 0 ? <div className="empty-state"><Icon name="bell" size={28} /><strong>You’re all caught up</strong><p>New mentions and conversation activity will appear here.</p></div> : <div className="notification-list">{loaderData.notifications.map((notification) => <article className={`notification-row${notification.readAt ? "" : " notification-row--unread"}`} key={notification.id}><span className="notification-row-icon"><Icon name={notification.type === "mention" ? "user" : "message"} size={18} /></span><div><p>{notification.body}</p><time>{formatDate(notification.createdAt)}</time></div>{notification.postId && !notification.readAt ? <Form method="post"><input name="intent" type="hidden" value="mark-one-read" /><input name="notificationId" type="hidden" value={notification.id} /><button className="notification-open-button" type="submit">Open <Icon name="chevron-right" size={15} /></button></Form> : notification.postId ? <Link className="notification-open-button" to={`/posts/${notification.postId}${notification.commentId ? `#comment-${notification.commentId}` : ""}`}>Open <Icon name="chevron-right" size={15} /></Link> : null}</article>)}</div>}
		</section>
	</div>;
}
