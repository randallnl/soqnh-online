import { z } from "zod";

const identifier = z.string().trim().min(1).max(100);
const optionalReason = z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : null,
	z.string().max(500).nullable(),
);

export const submitAffiliationRequestSchema = z.object({
	intent: z.literal("submit-affiliation-request"),
	affiliationId: identifier,
});

export const cancelAffiliationRequestSchema = z.object({
	intent: z.literal("cancel-affiliation-request"),
	requestId: z.uuid(),
});

export const reviewAffiliationRequestSchema = z.discriminatedUnion("decision", [
	z.object({
		intent: z.literal("review-affiliation-request"),
		requestId: z.uuid(),
		decision: z.literal("approve"),
		reason: optionalReason,
	}),
	z.object({
		intent: z.literal("review-affiliation-request"),
		requestId: z.uuid(),
		decision: z.literal("reject"),
		reason: z.string().trim().min(3, "Explain why this request cannot be approved").max(500),
	}),
]);
