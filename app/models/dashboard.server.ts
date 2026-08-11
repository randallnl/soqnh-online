import { and, count, eq, gte } from "drizzle-orm";

import { events, organizations, posts, users } from "~/db/schema";
import { createDatabase } from "~/lib/db.server";

export type DashboardCounts = {
	activeMembers: number;
	organizations: number;
	pendingEvents: number;
	upcomingEvents: number;
};

export async function getDashboardCounts(
	d1: D1Database,
): Promise<DashboardCounts | null> {
	try {
		const database = createDatabase(d1);
		const now = new Date().toISOString();
		const [memberRows, organizationRows, pendingRows, upcomingRows] =
			await Promise.all([
				database
					.select({ value: count() })
					.from(users)
					.where(eq(users.status, "active")),
				database
					.select({ value: count() })
					.from(organizations)
					.where(eq(organizations.status, "active")),
				database
					.select({ value: count() })
					.from(posts)
					.where(
						and(eq(posts.section, "event"), eq(posts.status, "draft")),
					),
				database
					.select({ value: count() })
					.from(events)
					.innerJoin(posts, eq(events.postId, posts.id))
					.where(
						and(
							eq(posts.section, "event"),
							eq(posts.status, "published"),
							gte(events.startsAt, now),
						),
					),
			]);

		return {
			activeMembers: memberRows[0]?.value ?? 0,
			organizations: organizationRows[0]?.value ?? 0,
			pendingEvents: pendingRows[0]?.value ?? 0,
			upcomingEvents: upcomingRows[0]?.value ?? 0,
		};
	} catch (error) {
		console.warn(
			JSON.stringify({
				message: "dashboard counts unavailable; using preview data",
				error: error instanceof Error ? error.message : "Unknown error",
			}),
		);
		return null;
	}
}
