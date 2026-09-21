import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-organizations";
import { Icon } from "~/components/icon";
import { OrganizationProfileFields } from "~/components/organization-profile-fields";
import { requireSiteAdmin } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { serializeOrganizationCategories } from "~/lib/organization-categories";
import { serializeOrganizationLeadership } from "~/lib/organization-leadership";
import { organizationRoleLabels, reviewOrganizationClaimSchema } from "~/lib/organization-claims";
import {
	slugifyOrganizationName,
} from "~/lib/organizations";
import {
	createOrganization,
	listOrganizationAdministrationPage,
	listDirectoryReviewQueue,
	OrganizationMutationError,
	reviewDirectoryParticipation,
} from "~/models/organizations.server";
import { listReviewableOrganizationClaims, OrganizationClaimMutationError, reviewOrganizationClaim } from "~/models/organization-claims.server";

const optionalText = (maximum: number) =>
	z.preprocess(
		(value) => (typeof value === "string" && value.trim() ? value.trim() : null),
		z.string().max(maximum).nullable(),
	);
const optionalUrl = z.preprocess(
	(value) => (typeof value === "string" && value.trim() ? value.trim() : null),
	z.url("Enter a full website URL").max(500).nullable(),
);
const optionalEmail = z.preprocess(
	(value) => (typeof value === "string" && value.trim() ? value.trim() : null),
	z.email("Enter a valid contact email").max(320).nullable(),
);
const identifier = z.string().trim().min(1).max(100);
const statewideValue = z.preprocess((value) => value === "yes" ? 1 : value === "no" ? 0 : null, z.union([z.literal(0), z.literal(1), z.null()]));
const organizationFields = z.object({
	name: z.string().trim().min(2, "Enter an organization name").max(120),
	slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens").max(80),
	summary: optionalText(240),
	description: optionalText(4000),
	category: optionalText(600),
	websiteUrl: optionalUrl,
	eventSourceUrl: optionalUrl,
	contactEmail: optionalEmail,
	contactPhone: optionalText(80),
	townCity: optionalText(200),
	region: optionalText(120),
	socialPlatform: optionalText(80),
	socialHandle: optionalText(200),
	listingRationale: optionalText(2000),
	leadershipIdentity: optionalText(100),
	sourceImageUrls: optionalText(4000),
	operatesStatewide: statewideValue,
});
const createSchema = organizationFields.extend({ intent: z.literal("create") });
const directoryReviewSchema = z.object({
	intent: z.literal("review-directory"),
	organizationId: identifier,
	decision: z.enum(["approve", "reject"]),
	note: optionalText(500),
});

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Organization administration · NH Connect" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const url = new URL(request.url);
	const [data, pendingClaims, directoryQueue] = await Promise.all([
		listOrganizationAdministrationPage(context.cloudflare.env, {
			query: url.searchParams.get("q") ?? "",
			page: Number(url.searchParams.get("page") ?? 1),
		}),
		listReviewableOrganizationClaims(context.cloudflare.env, admin),
		listDirectoryReviewQueue(context.cloudflare.env),
	]);
	return { ...data, pendingClaims, directoryQueue, deleted: url.searchParams.has("deleted") };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const formData = await request.formData();
	const raw = Object.fromEntries(formData);
	if (raw.intent === "review-directory") {
		const review = directoryReviewSchema.safeParse(raw);
		if (!review.success) return { ok: false as const, intent: "review-directory", error: review.error.issues[0]?.message ?? "Check the opt-in decision" };
		if (review.data.decision === "reject" && !review.data.note) return { ok: false as const, intent: "review-directory", error: "Add the changes needed before returning this request." };
		try {
			await reviewDirectoryParticipation(context.cloudflare.env, admin, review.data);
			return { ok: true as const, intent: "review-directory", message: review.data.decision === "approve" ? "Organization approved for the NH Connect public directory." : "Opt-in request returned for changes." };
		} catch (error) {
			if (error instanceof OrganizationMutationError) return { ok: false as const, intent: "review-directory", error: error.reason === "directory-transition" ? "That request has already been reviewed." : "The opt-in request could not be reviewed." };
			throw error;
		}
	}
	if (raw.intent === "review-organization-claim") {
		const review = reviewOrganizationClaimSchema.safeParse(raw);
		if (!review.success) return { ok: false as const, intent: "review-organization-claim", error: review.error.issues[0]?.message ?? "Check the claim decision" };
		try {
			await reviewOrganizationClaim(context.cloudflare.env, admin, review.data);
			return { ok: true as const, intent: "review-organization-claim", message: review.data.decision === "approve" ? "Membership claim approved." : "Membership claim rejected." };
		} catch (error) {
			if (error instanceof OrganizationClaimMutationError) {
				const messages = { "organization-unavailable": "That organization is unavailable.", "same-role": "The member already has that role.", "already-pending": "That claim is already pending.", "claim-unavailable": "That claim is no longer available.", "already-reviewed": "Another administrator already reviewed that claim.", forbidden: "You cannot review that claim.", "self-review": "You cannot approve your own claim.", "member-unavailable": "The member or organization is no longer active." };
				return { ok: false as const, intent: "review-organization-claim", error: messages[error.reason] };
			}
			throw error;
		}
	}
	if (raw.intent === "create" && !raw.slug && typeof raw.name === "string") {
		raw.slug = slugifyOrganizationName(raw.name);
	}
	raw.category = serializeOrganizationCategories(formData.getAll("category"));
	raw.leadershipIdentity = serializeOrganizationLeadership(formData.getAll("leadershipIdentity"));
	const result = createSchema.safeParse(raw);
	if (!result.success) {
		return { ok: false as const, intent: "create", error: result.error.issues[0]?.message ?? "Check the organization details" };
	}

	try {
		await createOrganization(context.cloudflare.env, admin, result.data);
		return redirect(`/admin/organizations/${result.data.slug}?created=1`);
	} catch (error) {
		if (error instanceof OrganizationMutationError) {
			const messages = {
				"not-found": "That organization is no longer available.",
				"slug-conflict": "That organization URL slug is already in use.",
				"member-unavailable": "Only active members can be assigned to an organization.",
				"membership-not-found": "That membership has already been removed.",
				"forbidden": "You no longer have permission to manage that organization.",
				"self-management": "Organization administrators cannot remove or demote their own access.",
				"directory-transition": "The NH Connect public directory status changed. Refresh and try again.",
			};
			return { ok: false as const, intent: "create", error: messages[error.reason] };
		}
		console.error(JSON.stringify({ message: "organization administration failed", actorUserId: admin.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, intent: "create", error: "The organization change could not be saved." };
	}
}

export default function AdminOrganizations({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	return (
		<div className="admin-page organization-admin-page">
			<section className="page-heading"><div><p className="eyebrow">Site administration</p><h1>Organizations</h1><p>Manage organization profiles and the people who can view, contribute, or administer them.</p></div><Link className="button button--secondary heading-action" to="/organizations"><Icon name="building" size={17} /> View directory</Link></section>
			{loaderData.deleted && <p role="status" className="admin-notice form-message form-message--success">Organization permanently deleted. Existing posts and events were retained without organization attribution.</p>}
			{actionData && actionData.intent !== "create" && <p className={`admin-notice form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}

			<section className="panel directory-review-panel" id="directory-opt-in-requests">
				<div className="panel-heading"><div><p className="eyebrow">NH Connect public directory</p><h2>Opt-in requests</h2></div><span>{loaderData.directoryQueue.length}</span></div>
				{loaderData.directoryQueue.length === 0 ? <p className="muted-empty">No organizations are awaiting opt-in review.</p> : <div className="directory-review-list">{loaderData.directoryQueue.map((organization) => <article key={organization.id}><div className="directory-review-summary"><span className="organization-monogram">{organization.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span><div><strong>{organization.name}</strong><p>Requested by {organization.requesterName || organization.requesterEmail || "an organization administrator"}</p><small>{organization.summary || "No organization summary supplied."}</small></div></div><div className="directory-review-actions"><Form method="post"><input name="intent" type="hidden" value="review-directory" /><input name="organizationId" type="hidden" value={organization.id} /><input name="decision" type="hidden" value="approve" /><button className="button button--primary button--compact" disabled={submitting} type="submit">Approve</button></Form><Form className="directory-review-reject" method="post"><input name="intent" type="hidden" value="review-directory" /><input name="organizationId" type="hidden" value={organization.id} /><input name="decision" type="hidden" value="reject" /><input aria-label={`Changes needed for ${organization.name}`} maxLength={500} name="note" placeholder="Changes needed" required /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Return</button></Form></div></article>)}</div>}
			</section>

			<section className="panel organization-claim-review-panel" id="membership-claims">
				<div className="panel-heading"><div><p className="eyebrow">Membership moderation</p><h2>Pending organization claims</h2></div><span>{loaderData.pendingClaims.length}</span></div>
				{loaderData.pendingClaims.length === 0 ? <p className="muted-empty">No organization membership claims are awaiting review.</p> : <div className="organization-claim-review-list">{loaderData.pendingClaims.map((claim) => <article key={claim.id}><div><strong>{claim.userName || claim.userEmail}</strong><p>{claim.userName ? `${claim.userEmail} · ` : ""}{claim.organizationName} · {organizationRoleLabels[claim.requestedRole]}{claim.currentRole ? ` · currently ${organizationRoleLabels[claim.currentRole]}` : ""}</p></div><div className="organization-claim-actions"><Form method="post"><input name="intent" type="hidden" value="review-organization-claim" /><input name="claimId" type="hidden" value={claim.id} /><input name="decision" type="hidden" value="approve" /><button className="button button--primary button--compact" disabled={submitting} type="submit">Approve</button></Form><Form className="organization-claim-reject-form" method="post"><input name="intent" type="hidden" value="review-organization-claim" /><input name="claimId" type="hidden" value={claim.id} /><input name="decision" type="hidden" value="reject" /><input aria-label={`Reason for rejecting ${claim.userName || claim.userEmail}`} maxLength={500} name="reason" placeholder="Reason for rejection" required /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Reject</button></Form></div></article>)}</div>}
			</section>

			<details className="panel organization-create-panel" open={actionData?.intent === "create" ? true : undefined}>
				<summary className="panel-heading"><div><p className="eyebrow">New profile</p><h2>Add an organization</h2></div><Icon name="chevron-right" size={18} /></summary>
				<Form className="organization-create-form" method="post">
					<input name="intent" type="hidden" value="create" />
					<OrganizationProfileFields />
					<label>URL slug<input name="slug" placeholder="generated-from-name" /></label>
					{actionData && actionData.intent === "create" && !actionData.ok && <p role="alert" className="form-message form-message--error">{actionData.error}</p>}
					<button className="button button--primary" disabled={submitting} type="submit"><Icon name="plus" size={17} /> Create organization</button>
				</Form>
			</details>

			<section className="panel organization-admin-directory">
				<div className="panel-heading"><div><p className="eyebrow">Profiles</p><h2>All organizations</h2></div><span>{loaderData.total}</span></div>
				<Form className="organization-admin-search" method="get">
					<input aria-label="Search organizations" defaultValue={loaderData.query} name="q" placeholder="Search by name or URL slug" type="search" />
					<button className="button button--secondary button--compact" type="submit">Search</button>
				</Form>
				{loaderData.organizations.length === 0 ? <p className="muted-empty">No organizations match this search.</p> : <div className="organization-admin-list">
					{loaderData.organizations.map((organization) => <Link className="organization-admin-row" key={organization.id} to={`/admin/organizations/${organization.slug}`}>
						<span className="organization-monogram">{organization.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span>
						<span className="organization-admin-row__details"><strong>{organization.name}</strong><small>/{organization.slug} · {organization.memberCount} members · {organization.directoryStatus === "published" ? "participating" : organization.directoryStatus.replaceAll("_", " ")}</small></span>
						<span className={`status-pill status-pill--${organization.status}`}>{organization.status}</span>
						<Icon name="chevron-right" size={18} />
					</Link>)}
				</div>}
				{loaderData.totalPages > 1 && <nav aria-label="Organization pages" className="organization-admin-pagination">
					{loaderData.page > 1 && <Link className="button button--secondary button--compact" to={`?q=${encodeURIComponent(loaderData.query)}&page=${loaderData.page - 1}`}>Previous</Link>}
					<span>Page {loaderData.page} of {loaderData.totalPages}</span>
					{loaderData.page < loaderData.totalPages && <Link className="button button--secondary button--compact" to={`?q=${encodeURIComponent(loaderData.query)}&page=${loaderData.page + 1}`}>Next</Link>}
				</nav>}
			</section>
		</div>
	);
}
