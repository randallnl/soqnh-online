import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-organizations";
import { Icon } from "~/components/icon";
import { OrganizationProfileFields } from "~/components/organization-profile-fields";
import { requireSiteAdmin } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { deleteIdentityImage } from "~/lib/media.server";
import { organizationRoleLabels, reviewOrganizationClaimSchema } from "~/lib/organization-claims";
import {
	organizationRoles,
	organizationStatuses,
	slugifyOrganizationName,
} from "~/lib/organizations";
import {
	createOrganization,
	deleteOrganization,
	getOrganizationAdministrationData,
	listDirectoryReviewQueue,
	OrganizationMutationError,
	removeOrganizationMembership,
	reviewDirectoryParticipation,
	setOrganizationMembership,
	updateOrganization,
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
const actionSchema = z.discriminatedUnion("intent", [
	organizationFields.extend({ intent: z.literal("create") }),
	organizationFields.extend({
		intent: z.literal("update"),
		organizationId: identifier,
		status: z.enum(organizationStatuses),
	}),
	z.object({
		intent: z.literal("set-membership"),
		organizationId: identifier,
		userId: identifier,
		role: z.enum(organizationRoles),
	}),
	z.object({
		intent: z.literal("remove-membership"),
		organizationId: identifier,
		userId: identifier,
	}),
	z.object({ intent: z.literal("delete-organization"), organizationId: identifier }),
]);
const directoryReviewSchema = z.object({
	intent: z.literal("review-directory"),
	organizationId: identifier,
	decision: z.enum(["approve", "reject"]),
	note: optionalText(500),
});

const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Organization administration · State of Queer NH" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const [data, pendingClaims, directoryQueue] = await Promise.all([
		getOrganizationAdministrationData(context.cloudflare.env),
		listReviewableOrganizationClaims(context.cloudflare.env, admin),
		listDirectoryReviewQueue(context.cloudflare.env),
	]);
	return { ...data, pendingClaims, directoryQueue };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const formData = await request.formData();
	const raw = Object.fromEntries(formData);
	if (raw.intent === "review-directory") {
		const review = directoryReviewSchema.safeParse(raw);
		if (!review.success) return { ok: false as const, error: review.error.issues[0]?.message ?? "Check the opt-in decision" };
		if (review.data.decision === "reject" && !review.data.note) return { ok: false as const, error: "Add the changes needed before returning this request." };
		try {
			await reviewDirectoryParticipation(context.cloudflare.env, admin, review.data);
			return { ok: true as const, message: review.data.decision === "approve" ? "Organization approved for State of Queer Digital." : "Opt-in request returned for changes." };
		} catch (error) {
			if (error instanceof OrganizationMutationError) return { ok: false as const, error: error.reason === "directory-transition" ? "That request has already been reviewed." : "The opt-in request could not be reviewed." };
			throw error;
		}
	}
	if (raw.intent === "review-organization-claim") {
		const review = reviewOrganizationClaimSchema.safeParse(raw);
		if (!review.success) return { ok: false as const, error: review.error.issues[0]?.message ?? "Check the claim decision" };
		try {
			await reviewOrganizationClaim(context.cloudflare.env, admin, review.data);
			return { ok: true as const, message: review.data.decision === "approve" ? "Membership claim approved." : "Membership claim rejected." };
		} catch (error) {
			if (error instanceof OrganizationClaimMutationError) {
				const messages = { "organization-unavailable": "That organization is unavailable.", "same-role": "The member already has that role.", "already-pending": "That claim is already pending.", "claim-unavailable": "That claim is no longer available.", "already-reviewed": "Another administrator already reviewed that claim.", forbidden: "You cannot review that claim.", "self-review": "You cannot approve your own claim.", "member-unavailable": "The member or organization is no longer active." };
				return { ok: false as const, error: messages[error.reason] };
			}
			throw error;
		}
	}
	if (raw.intent === "create" && !raw.slug && typeof raw.name === "string") {
		raw.slug = slugifyOrganizationName(raw.name);
	}
	const result = actionSchema.safeParse(raw);
	if (!result.success) {
		return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the organization details" };
	}

	try {
		if (result.data.intent === "create") {
			await createOrganization(context.cloudflare.env, admin, result.data);
			return { ok: true as const, message: "Organization created." };
		}
		if (result.data.intent === "update") {
			await updateOrganization(context.cloudflare.env, admin, result.data);
			return { ok: true as const, message: "Organization profile updated." };
		}
		if (result.data.intent === "set-membership") {
			await setOrganizationMembership(context.cloudflare.env, admin, result.data);
			return { ok: true as const, message: "Organization membership updated." };
		}
		if (result.data.intent === "delete-organization") {
			const deleted = await deleteOrganization(context.cloudflare.env, admin, result.data.organizationId);
			if (deleted.logoObjectKey) context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, deleted.logoObjectKey));
			return { ok: true as const, message: "Organization permanently deleted. Existing posts and events were retained without organization attribution." };
		}
		await removeOrganizationMembership(context.cloudflare.env, admin, result.data);
		return { ok: true as const, message: "Member removed from the organization." };
	} catch (error) {
		if (error instanceof OrganizationMutationError) {
			const messages = {
				"not-found": "That organization is no longer available.",
				"slug-conflict": "That organization URL slug is already in use.",
				"member-unavailable": "Only active members can be assigned to an organization.",
				"membership-not-found": "That membership has already been removed.",
				"forbidden": "You no longer have permission to manage that organization.",
				"self-management": "Organization administrators cannot remove or demote their own access.",
				"directory-transition": "The State of Queer Digital participation status changed. Refresh and try again.",
			};
			return { ok: false as const, error: messages[error.reason] };
		}
		console.error(JSON.stringify({ message: "organization administration failed", actorUserId: admin.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "The organization change could not be saved." };
	}
}

export default function AdminOrganizations({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	return (
		<div className="admin-page organization-admin-page">
			<section className="page-heading"><div><p className="eyebrow">Site administration</p><h1>Organizations</h1><p>Manage organization profiles and the people who can view, contribute, or administer them.</p></div><Link className="button button--secondary heading-action" to="/organizations"><Icon name="building" size={17} /> View directory</Link></section>
			{actionData && <p className={`admin-notice form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}

			<section className="panel directory-review-panel" id="directory-opt-in-requests">
				<div className="panel-heading"><div><p className="eyebrow">State of Queer Digital</p><h2>Opt-in requests</h2></div><span>{loaderData.directoryQueue.length}</span></div>
				{loaderData.directoryQueue.length === 0 ? <p className="muted-empty">No organizations are awaiting opt-in review.</p> : <div className="directory-review-list">{loaderData.directoryQueue.map((organization) => <article key={organization.id}><div className="directory-review-summary"><span className="organization-monogram">{organization.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span><div><strong>{organization.name}</strong><p>Requested by {organization.requesterName || organization.requesterEmail || "an organization administrator"}</p><small>{organization.summary || "No organization summary supplied."}</small></div></div><div className="directory-review-actions"><Form method="post"><input name="intent" type="hidden" value="review-directory" /><input name="organizationId" type="hidden" value={organization.id} /><input name="decision" type="hidden" value="approve" /><button className="button button--primary button--compact" disabled={submitting} type="submit">Approve</button></Form><Form className="directory-review-reject" method="post"><input name="intent" type="hidden" value="review-directory" /><input name="organizationId" type="hidden" value={organization.id} /><input name="decision" type="hidden" value="reject" /><input aria-label={`Changes needed for ${organization.name}`} maxLength={500} name="note" placeholder="Changes needed" required /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Return</button></Form></div></article>)}</div>}
			</section>

			<section className="panel organization-claim-review-panel" id="membership-claims">
				<div className="panel-heading"><div><p className="eyebrow">Membership moderation</p><h2>Pending organization claims</h2></div><span>{loaderData.pendingClaims.length}</span></div>
				{loaderData.pendingClaims.length === 0 ? <p className="muted-empty">No organization membership claims are awaiting review.</p> : <div className="organization-claim-review-list">{loaderData.pendingClaims.map((claim) => <article key={claim.id}><div><strong>{claim.userName || claim.userEmail}</strong><p>{claim.userName ? `${claim.userEmail} · ` : ""}{claim.organizationName} · {organizationRoleLabels[claim.requestedRole]}{claim.currentRole ? ` · currently ${organizationRoleLabels[claim.currentRole]}` : ""}</p></div><div className="organization-claim-actions"><Form method="post"><input name="intent" type="hidden" value="review-organization-claim" /><input name="claimId" type="hidden" value={claim.id} /><input name="decision" type="hidden" value="approve" /><button className="button button--primary button--compact" disabled={submitting} type="submit">Approve</button></Form><Form className="organization-claim-reject-form" method="post"><input name="intent" type="hidden" value="review-organization-claim" /><input name="claimId" type="hidden" value={claim.id} /><input name="decision" type="hidden" value="reject" /><input aria-label={`Reason for rejecting ${claim.userName || claim.userEmail}`} maxLength={500} name="reason" placeholder="Reason for rejection" required /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Reject</button></Form></div></article>)}</div>}
			</section>

			<section className="panel organization-create-panel">
				<div className="panel-heading"><div><p className="eyebrow">New profile</p><h2>Add an organization</h2></div></div>
				<Form className="organization-create-form" method="post">
					<input name="intent" type="hidden" value="create" />
					<OrganizationProfileFields />
					<label>URL slug<input name="slug" placeholder="generated-from-name" /></label>
					<button className="button button--primary" disabled={submitting} type="submit"><Icon name="plus" size={17} /> Create organization</button>
				</Form>
			</section>

			<section className="organization-admin-list">
				{loaderData.organizations.map((organization) => {
					const memberships = loaderData.memberships.filter((item) => item.organizationId === organization.id);
					return (
						<details className="panel organization-admin-card" key={organization.id}>
							<summary>
								<span className="organization-monogram">{organization.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span>
								<div><strong>{organization.name}</strong><p>/{organization.slug} · {organization.memberCount} members · {organization.directoryStatus === "published" ? "participating" : organization.directoryStatus.replaceAll("_", " ")}</p></div>
								<span className={`status-pill status-pill--${organization.status}`}>{organization.status}</span>
								<Icon name="chevron-right" size={18} />
							</summary>
							<div className="organization-admin-body">
								<Form className="organization-edit-form" method="post">
									<input name="intent" type="hidden" value="update" /><input name="organizationId" type="hidden" value={organization.id} />
									<OrganizationProfileFields organization={organization} />
									<label>URL slug<input defaultValue={organization.slug} name="slug" required /></label>
									<label>Status<select defaultValue={organization.status} name="status">{organizationStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
									<button className="button button--secondary" disabled={submitting} type="submit">Save profile</button>
								</Form>

								<div className="organization-membership-manager">
									<div className="subsection-heading"><div><p className="eyebrow">Access roles</p><h3>Members</h3></div><Link to={`/organizations/${organization.slug}`}>Open profile</Link></div>
									<Form className="membership-add-form" method="post">
										<input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} />
										<select aria-label="Member" name="userId" required><option value="">Select an active member</option>{loaderData.availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name ? `${member.name} — ${member.email}` : member.email}</option>)}</select>
										<select aria-label="Role" defaultValue="viewer" name="role">{organizationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>
										<button className="button button--primary button--compact" type="submit">Add or update</button>
									</Form>
									<div className="managed-membership-list">
										{memberships.length === 0 ? <p className="muted-empty">No members assigned yet.</p> : memberships.map((membership) => (
											<article key={membership.userId}><div><strong>{membership.name || membership.email}</strong><p>{membership.email}</p></div><Form method="post"><input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={membership.userId} /><select aria-label={`Role for ${membership.name || membership.email}`} defaultValue={membership.role} name="role" onChange={(event) => event.currentTarget.form?.requestSubmit()}>{organizationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></Form><Form method="post" onSubmit={(event) => { if (!window.confirm(`Remove ${membership.name || membership.email} from ${organization.name}?`)) event.preventDefault(); }}><input name="intent" type="hidden" value="remove-membership" /><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={membership.userId} /><button className="member-action-button member-action-button--suspend" type="submit">Remove</button></Form></article>
										))}
									</div>
									<div className="organization-danger-zone">
										<div><strong>Delete organization</strong><p>Permanently remove this profile, memberships, claims, and affiliation links. Existing posts and events will remain without organization attribution.</p></div>
										<Form method="post" onSubmit={(event) => { if (!window.confirm(`Permanently delete ${organization.name}? This cannot be undone.`)) event.preventDefault(); }}>
											<input name="intent" type="hidden" value="delete-organization" /><input name="organizationId" type="hidden" value={organization.id} />
											<button className="member-action-button member-action-button--delete" disabled={submitting} type="submit">Delete organization</button>
										</Form>
									</div>
								</div>
							</div>
						</details>
					);
				})}
			</section>
		</div>
	);
}
