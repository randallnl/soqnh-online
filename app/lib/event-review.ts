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
