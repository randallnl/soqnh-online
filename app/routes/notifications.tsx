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
	if (!notification) return { ok: false as const, error: "That notification is no longer available." };
	const target = notification.postId
		? `/posts/${notification.postId}${notification.commentId ? `#comment-${notification.commentId}` : ""}`
		: notification.targetUrl;
	if (!target || !target.startsWith("/") || target.startsWith("//")) return { ok: false as const, error: "That notification does not have a destination." };
	throw redirect(target);
}

export function meta() {
	return [{ title: "Notifications · NH Connect" }];
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

const notificationGroups = [
	{ id: "mention", title: "Mentions", description: "People tagging you in posts and comments.", types: ["mention"], icon: "user" },
	{ id: "conversation", title: "Comments & replies", description: "New conversation activity connected to your posts.", types: ["comment"], icon: "message" },
	{ id: "support", title: "Support", description: "Members showing support for your posts.", types: ["support"], icon: "heart" },
	{ id: "moderation", title: "Moderation decisions", description: "Updates about submitted events and reviewed content.", types: ["moderation"], icon: "clipboard" },
	{ id: "membership", title: "Membership & affiliations", description: "Organization claims and affiliation access decisions.", types: ["membership"], icon: "people" },
	{ id: "directory", title: "Directory updates", description: "Decisions about public organization listings.", types: ["directory"], icon: "building" },
	{ id: "other", title: "Other activity", description: "Earlier decisions and workspace activity.", types: ["approval"], icon: "activity" },
] as const;

function destination(notification: { postId: string | null; commentId: string | null; targetUrl: string | null }) {
	return notification.postId ? `/posts/${notification.postId}${notification.commentId ? `#comment-${notification.commentId}` : ""}` : notification.targetUrl;
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const populatedGroups = notificationGroups.map((group) => ({
		...group,
		notifications: loaderData.notifications.filter((notification) => (group.types as readonly string[]).includes(notification.type)),
	})).filter((group) => group.notifications.length > 0);
	return <div className="notifications-page">
		<section className="page-heading notifications-heading"><div><p className="eyebrow">Stay connected</p><h1>Notifications</h1><p>Mentions, replies, support, and activity on your posts appear here.</p></div>{loaderData.unreadCount > 0 && <Form method="post"><input name="intent" type="hidden" value="mark-all-read" /><button className="button button--secondary" disabled={navigation.state === "submitting"} type="submit">Mark all read</button></Form>}</section>
		{loaderData.notifications.length === 0 ? <section className="panel notification-inbox"><div className="empty-state"><Icon name="bell" size={28} /><strong>You’re all caught up</strong><p>New mentions and activity on your posts will appear here.</p></div></section> : <div className="notification-groups">{populatedGroups.map((group) => {
			const unread = group.notifications.filter((notification) => !notification.readAt).length;
			return <section className="panel notification-inbox" key={group.id}><div className="notification-group-heading"><span><Icon name={group.icon} size={19} /></span><div><h2>{group.title}</h2><p>{group.description}</p></div><b>{unread > 0 ? `${unread} new` : group.notifications.length}</b></div><div className="notification-list">{group.notifications.map((notification) => {
				const target = destination(notification);
				return <article className={`notification-row${notification.readAt ? "" : " notification-row--unread"}`} key={notification.id}><span aria-label={notification.readAt ? "Read" : "Unread"} className="notification-unread-marker" /><div><p>{notification.body}</p><time>{formatDate(notification.createdAt)}</time></div>{target && !notification.readAt ? <Form method="post"><input name="intent" type="hidden" value="mark-one-read" /><input name="notificationId" type="hidden" value={notification.id} /><button className="notification-open-button" type="submit">Open <Icon name="chevron-right" size={15} /></button></Form> : target ? <Link className="notification-open-button" to={target}>Open <Icon name="chevron-right" size={15} /></Link> : null}</article>;
			})}</div></section>;
		})}</div>}
	</div>;
}
