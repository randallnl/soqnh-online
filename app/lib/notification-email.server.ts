import type { AuthenticatedUser } from "./auth.server";
import { sendMentionEmail, sendWeeklyDigestEmail, type WeeklyDigestItem } from "./email.server";
import { listMentionEmailRecipients, listWeeklyDigestRecipients } from "../models/notification-preferences.server";
import { listSectionPosts, type PostRecord } from "../models/posts.server";

function digestItem(post: PostRecord): WeeklyDigestItem {
	return {
		id: post.id,
		title: post.title,
		organizationName: post.organizationName,
		createdAt: post.createdAt,
		eventStartsAt: post.eventStartsAt,
		imageUrl: post.eventImageUrl,
	};
}

function recentPosts(posts: PostRecord[], cutoff: number) {
	return posts.filter((post) => new Date(post.createdAt).getTime() >= cutoff).slice(0, 4).map(digestItem);
}

function logEmailFailure(message: string, details: Record<string, unknown>, error: unknown) {
	console.error(JSON.stringify({
		message,
		...details,
		error: error instanceof Error ? error.message : String(error),
	}));
}

export async function sendMentionNotificationEmails(env: Env, input: {
	recipientIds: string[];
	actorName: string;
	kind: "update" | "comment";
	postId: string;
	commentId?: string | null;
}) {
	const recipients = await listMentionEmailRecipients(env, input.recipientIds);
	const results = await Promise.allSettled(recipients.map((recipient) => sendMentionEmail(env, {
		to: recipient.email,
		recipientName: recipient.name,
		actorName: input.actorName,
		kind: input.kind,
		postId: input.postId,
		commentId: input.commentId,
	})));
	let sent = 0;
	results.forEach((result, index) => {
		if (result.status === "fulfilled") sent += 1;
		else logEmailFailure("mention email failed", { recipientUserId: recipients[index]?.id, postId: input.postId }, result.reason);
	});
	return { eligible: recipients.length, sent, failed: recipients.length - sent };
}

async function buildWeeklyDigest(env: Env, recipient: AuthenticatedUser, scheduledAt: Date) {
	const [updates, projects, events] = await Promise.all([
		listSectionPosts(env, recipient, { section: "update", tag: null, organizationId: null, page: 1 }),
		listSectionPosts(env, recipient, { section: "project", tag: null, organizationId: null, page: 1 }),
		listSectionPosts(env, recipient, { section: "event", tag: null, organizationId: null, eventTiming: "upcoming", page: 1 }),
	]);
	const cutoff = scheduledAt.getTime() - 7 * 24 * 60 * 60 * 1000;
	return {
		updates: recentPosts(updates.posts, cutoff),
		projects: recentPosts(projects.posts, cutoff),
		events: events.posts.slice(0, 4).map(digestItem),
	};
}

export async function sendWeeklyDigestEmails(env: Env, scheduledAt = new Date()) {
	const recipients = await listWeeklyDigestRecipients(env);
	let sent = 0;
	let failed = 0;
	for (let offset = 0; offset < recipients.length; offset += 10) {
		const batch = recipients.slice(offset, offset + 10);
		const results = await Promise.allSettled(batch.map(async (recipient) => {
			const digest = await buildWeeklyDigest(env, recipient, scheduledAt);
			await sendWeeklyDigestEmail(env, {
				to: recipient.email,
				recipientName: recipient.name,
				...digest,
			});
		}));
		results.forEach((result, index) => {
			if (result.status === "fulfilled") sent += 1;
			else {
				failed += 1;
				logEmailFailure("weekly digest email failed", { recipientUserId: batch[index]?.id }, result.reason);
			}
		});
	}
	console.log(JSON.stringify({ message: "weekly digest complete", eligible: recipients.length, sent, failed }));
	return { eligible: recipients.length, sent, failed };
}
