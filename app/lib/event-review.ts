import { z } from "zod";

export const eventPostIdSchema = z.string().trim().min(1).max(100).refine(
	(value) => z.string().uuid().safeParse(value).success || /^scraped:[a-f0-9]{64}$/.test(value),
	{ message: "That event is no longer available" },
);

export const eventReviewSchema = z.object({
	postId: eventPostIdSchema,
	decision: z.enum(["approve", "reject"]),
	reason: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : null,
		z.string().max(500).nullable(),
	),
}).refine((value) => value.decision !== "reject" || Boolean(value.reason), {
	message: "Explain what needs to change before rejecting the event",
	path: ["reason"],
});

const eventDateTimeSchema = z.string().trim().regex(
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
	"Choose an event date and time",
);

export const eventScheduleSchema = z.object({
	intent: z.literal("update-schedule"),
	postId: eventPostIdSchema,
	startsAt: eventDateTimeSchema,
	endsAt: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : null,
		eventDateTimeSchema.nullable(),
	),
}).refine((event) => !event.endsAt || event.endsAt >= event.startsAt, {
	message: "The event end must be after its start",
	path: ["endsAt"],
});
