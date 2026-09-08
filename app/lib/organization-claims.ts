import { z } from "zod";

import { organizationRoles } from "./organizations";

export const organizationRoleLabels = {
	viewer: "Member",
	contributor: "Contributor",
	org_admin: "Organization administrator",
} as const;

const identifier = z.string().trim().min(1).max(100);
const optionalReason = z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : null,
	z.string().max(500).nullable(),
);

export const submitOrganizationClaimSchema = z.object({
	intent: z.literal("submit-organization-claim"),
	organizationId: identifier,
	requestedRole: z.enum(organizationRoles),
});

export const cancelOrganizationClaimSchema = z.object({
	intent: z.literal("cancel-organization-claim"),
	claimId: z.uuid(),
});

export const reviewOrganizationClaimSchema = z.discriminatedUnion("decision", [
	z.object({
		intent: z.literal("review-organization-claim"),
		claimId: z.uuid(),
		decision: z.literal("approve"),
		reason: optionalReason,
	}),
	z.object({
		intent: z.literal("review-organization-claim"),
		claimId: z.uuid(),
		decision: z.literal("reject"),
		reason: z.string().trim().min(3, "Explain why this claim cannot be approved").max(500),
	}),
]);
