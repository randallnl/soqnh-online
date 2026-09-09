import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/organization-manage";
import { Icon } from "~/components/icon";
import { OrganizationIdentity } from "~/components/identity-avatar";
import { OrganizationProfileFields } from "~/components/organization-profile-fields";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { deleteIdentityImage, ImageUploadError, requireUploadRequestSize, uploadIdentityImage } from "~/lib/media.server";
import { serializeOrganizationCategories } from "~/lib/organization-categories";
import { organizationRoleLabels, reviewOrganizationClaimSchema } from "~/lib/organization-claims";
import { organizationRoles } from "~/lib/organizations";
import { listReviewableOrganizationClaims, OrganizationClaimMutationError, reviewOrganizationClaim } from "~/models/organization-claims.server";
import {
	getOrganizationManagementData,
	OrganizationMutationError,
	removeOrganizationMembership,
	requestDirectoryParticipation,
	setOrganizationMembership,
	updateManagedOrganizationProfile,
	updateOrganizationLogo,
	withdrawDirectoryParticipation,
} from "~/models/organizations.server";

const optionalText = (maximum: number) => z.preprocess(
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
const actionSchema = z.discriminatedUnion("intent", [
	z.object({
		intent: z.literal("update-profile"),
		organizationId: identifier,
		name: z.string().trim().min(2, "Enter an organization name").max(120),
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
	}),
	z.object({ intent: z.literal("set-membership"), organizationId: identifier, userId: identifier, role: z.enum(organizationRoles) }),
	z.object({ intent: z.literal("remove-membership"), organizationId: identifier, userId: identifier }),
	z.object({ intent: z.literal("remove-logo"), organizationId: identifier }),
]);

const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `Manage ${data?.organization.name ?? "organization"} · NH Connect` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	try {
		const data = await getOrganizationManagementData(context.cloudflare.env, user, params.slug);
		if (!data) throw new Response("Organization not found", { status: 404 });
		return { ...data, pendingClaims: await listReviewableOrganizationClaims(context.cloudflare.env, user, data.organization.id) };
	} catch (error) {
		if (error instanceof OrganizationMutationError) {
			throw new Response(error.reason === "not-found" ? "Organization not found" : "Forbidden", {
				status: error.reason === "not-found" ? 404 : 403,
			});
		}
		throw error;
	}
}

export async function action({ request, context, params }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	try {
		requireUploadRequestSize(request);
	} catch (error) {
		if (error instanceof ImageUploadError) return { ok: false as const, error: "Upload an image smaller than 10 MB." };
		throw error;
	}
	const formData = await request.formData();
	const raw = Object.fromEntries(formData);
	if (raw.intent === "review-organization-claim") {
		const review = reviewOrganizationClaimSchema.safeParse(raw);
		if (!review.success) return { ok: false as const, error: review.error.issues[0]?.message ?? "Check the claim decision" };
		try {
			await reviewOrganizationClaim(context.cloudflare.env, user, review.data);
			return { ok: true as const, message: review.data.decision === "approve" ? "Membership claim approved." : "Membership claim rejected." };
		} catch (error) {
			if (error instanceof OrganizationClaimMutationError) {
				const messages = { "organization-unavailable": "That organization is unavailable.", "same-role": "The member already has that role.", "already-pending": "That claim is already pending.", "claim-unavailable": "That claim is no longer available.", "already-reviewed": "Another administrator already reviewed that claim.", forbidden: "You cannot review that claim.", "self-review": "You cannot approve your own claim.", "member-unavailable": "The member or organization is no longer active." };
				return { ok: false as const, error: messages[error.reason] };
			}
			console.error(JSON.stringify({ message: "organization claim review failed", actorUserId: user.id, error: error instanceof Error ? error.message : String(error) }));
			return { ok: false as const, error: "The membership claim could not be reviewed." };
		}
	}
	if (raw.intent === "update-profile") {
		raw.category = serializeOrganizationCategories(formData.getAll("category"));
	}
	const result = actionSchema.safeParse(raw);
	if (!result.success) {
		return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the organization details" };
	}

	try {
		if (result.data.intent === "update-profile") {
			const managed = await getOrganizationManagementData(context.cloudflare.env, user, params.slug);
			if (!managed || managed.organization.id !== result.data.organizationId) throw new OrganizationMutationError("not-found");
			const directoryOptIn = formData.get("directoryOptIn") === "on";
			const wasParticipating = managed.organization.directoryStatus === "pending" || managed.organization.directoryStatus === "published";
			const newLogoKey = await uploadIdentityImage(context.cloudflare.env, formData.get("logo"), "org-logos", result.data.organizationId);
			try {
				await updateManagedOrganizationProfile(context.cloudflare.env, user, result.data);
				if (newLogoKey) {
					const oldLogoKey = await updateOrganizationLogo(context.cloudflare.env, user, { organizationId: result.data.organizationId, logoObjectKey: newLogoKey });
					if (oldLogoKey) context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, oldLogoKey));
				}
			} catch (error) {
				if (newLogoKey) await deleteIdentityImage(context.cloudflare.env, newLogoKey);
				throw error;
			}
			if (directoryOptIn && !wasParticipating) {
				await requestDirectoryParticipation(context.cloudflare.env, user, result.data.organizationId);
				return { ok: true as const, message: "Organization profile updated and the NH Connect public directory opt-in request was submitted for review." };
			}
			if (!directoryOptIn && wasParticipating) {
				await withdrawDirectoryParticipation(context.cloudflare.env, user, result.data.organizationId);
				return { ok: true as const, message: managed.organization.directoryStatus === "pending" ? "Organization profile updated and the opt-in request was canceled." : "Organization profile updated and removed from the NH Connect public directory." };
			}
			return { ok: true as const, message: "Organization profile updated." };
		}
		if (result.data.intent === "remove-logo") {
			const oldLogoKey = await updateOrganizationLogo(context.cloudflare.env, user, { organizationId: result.data.organizationId, logoObjectKey: null });
			if (oldLogoKey) context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, oldLogoKey));
			return { ok: true as const, message: "Organization logo removed." };
		}
		if (result.data.intent === "set-membership") {
			await setOrganizationMembership(context.cloudflare.env, user, result.data);
			return { ok: true as const, message: "Organization membership updated." };
		}
		await removeOrganizationMembership(context.cloudflare.env, user, result.data);
		return { ok: true as const, message: "Member removed from the organization." };
	} catch (error) {
		if (error instanceof ImageUploadError) {
			const message = error.reason === "too-large" ? "Upload an image smaller than 10 MB." : error.reason === "unsupported" ? "Upload a PNG, JPG, WebP, or GIF image." : "The uploaded file does not appear to be a valid image.";
			return { ok: false as const, error: message };
		}
		if (error instanceof OrganizationMutationError) {
			const messages = {
				"not-found": "That organization is no longer available.",
				"slug-conflict": "That organization URL slug is already in use.",
				"member-unavailable": "Only active and visible members can be assigned.",
				"membership-not-found": "That membership has already been removed.",
				"forbidden": "You no longer have permission to manage this organization.",
				"self-management": "Organization administrators cannot remove or demote their own access. Ask another administrator for help.",
				"directory-transition": "The NH Connect public directory status changed before this request could be completed. Refresh and try again.",
			};
			return { ok: false as const, error: messages[error.reason] };
		}
		console.error(JSON.stringify({ message: "organization self-service failed", actorUserId: user.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "The organization change could not be saved." };
	}
}

export default function OrganizationManage({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	const { organization, memberships } = loaderData;
	const directoryParticipating = organization.directoryStatus === "pending" || organization.directoryStatus === "published";

	return (
		<div className="organization-manage-page">
			<section className="page-heading">
				<div><p className="eyebrow">Organization workspace</p><h1>Manage {organization.name}</h1><p>Keep the public profile current and manage the people who participate through this organization.</p></div>
				<Link className="button button--secondary heading-action" to={`/organizations/${organization.slug}`}><Icon name="building" size={17} /> View profile</Link>
			</section>
			{actionData && <p className={`admin-notice form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}

			<section className="panel managed-profile-panel">
				<div className="panel-heading"><div><p className="eyebrow">Organization information</p><h2>Organization profile</h2></div><span className={`status-pill status-pill--${organization.status}`}>{organization.status}</span></div>
				<div className="organization-logo-editor"><OrganizationIdentity large logoObjectKey={organization.logoObjectKey} name={organization.name} /><div><strong>Organization logo</strong><p>PNG, JPG, WebP, or GIF. Maximum 10 MB.</p>{organization.logoObjectKey && <Form method="post"><input name="intent" type="hidden" value="remove-logo" /><input name="organizationId" type="hidden" value={organization.id} /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Remove logo</button></Form>}</div></div>
				<Form className="organization-edit-form" encType="multipart/form-data" method="post">
					<input name="intent" type="hidden" value="update-profile" /><input name="organizationId" type="hidden" value={organization.id} />
					<label>Organization logo<input accept="image/png,image/jpeg,image/webp,image/gif" name="logo" type="file" /></label>
					<OrganizationProfileFields organization={organization} />
					<div className={`directory-profile-opt-in directory-profile-opt-in--${organization.directoryStatus}`}>
						<label>
							<input
								aria-describedby="manage-directory-opt-in-description manage-directory-opt-in-status"
								defaultChecked={directoryParticipating}
								disabled={submitting}
								name="directoryOptIn"
								onChange={(event) => {
									if (!event.currentTarget.checked && directoryParticipating && !window.confirm("Remove this organization from the NH Connect public directory?")) event.currentTarget.checked = true;
								}}
								type="checkbox"
							/>
							<span><strong>Opt in to the NH Connect public directory</strong><small id="manage-directory-opt-in-description">All signed-in members can already view this organization profile. By checking this box, you confirm that its profile information may also be made public after administrator review; member and affiliation details remain private.</small></span>
						</label>
						<p id="manage-directory-opt-in-status">{organization.directoryStatus === "pending" ? "Pending administrator review. Uncheck the box and save to cancel this request." : organization.directoryStatus === "published" ? "Approved and eligible to appear in the public directory. Uncheck the box and save to opt out." : organization.directoryStatus === "rejected" ? `Changes requested${organization.directoryReviewNote ? `: ${organization.directoryReviewNote}` : "."} Check the box and save to resubmit.` : "Not currently opted in. Check the box and save to request review."}</p>
					</div>
					<button className="button button--primary" disabled={submitting} type="submit">Save profile</button>
				</Form>
				<div className="managed-affiliation-note"><div><p className="eyebrow">Coalition spaces</p><h3>Affiliations</h3></div>{organization.affiliations.length === 0 ? <p>No affiliations are assigned. The organization profile is still visible to signed-in members.</p> : <div className="affiliation-chip-row">{organization.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>}<small>Affiliations control coalition-scoped content and are only shown to people in those affiliations. They can only be changed by a site administrator.</small></div>
			</section>

			<section className="panel managed-members-panel">
				<div className="panel-heading"><div><p className="eyebrow">Participation</p><h2>Organization members</h2></div><span>{memberships.length}</span></div>
				<div className="managed-claim-queue"><div className="subsection-heading"><div><p className="eyebrow">Membership moderation</p><h3>Pending claims</h3></div><span>{loaderData.pendingClaims.length}</span></div>{loaderData.pendingClaims.length === 0 ? <p className="muted-empty">No membership claims are awaiting review.</p> : <div className="organization-claim-review-list">{loaderData.pendingClaims.map((claim) => <article key={claim.id}><div><strong>{claim.userName || claim.userEmail}</strong><p>{claim.userName ? `${claim.userEmail} · ` : ""}Requests {organizationRoleLabels[claim.requestedRole]}{claim.currentRole ? ` · currently ${organizationRoleLabels[claim.currentRole]}` : ""}</p></div><div className="organization-claim-actions"><Form method="post"><input name="intent" type="hidden" value="review-organization-claim" /><input name="claimId" type="hidden" value={claim.id} /><input name="decision" type="hidden" value="approve" /><button className="button button--primary button--compact" disabled={submitting} type="submit">Approve</button></Form><Form className="organization-claim-reject-form" method="post"><input name="intent" type="hidden" value="review-organization-claim" /><input name="claimId" type="hidden" value={claim.id} /><input name="decision" type="hidden" value="reject" /><input aria-label={`Reason for rejecting ${claim.userName || claim.userEmail}`} maxLength={500} name="reason" placeholder="Reason for rejection" required /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Reject</button></Form></div></article>)}</div>}</div>
				<div className="organization-membership-manager">
					<Form className="membership-add-form" method="post">
						<input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} />
						<select aria-label="Member" name="userId" required><option value="">Select an active member</option>{loaderData.availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name ? `${member.name} — ${member.email}` : member.email}</option>)}</select>
						<select aria-label="Role" defaultValue="viewer" name="role">{organizationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>
						<button className="button button--primary button--compact" type="submit">Add or update</button>
					</Form>
					<div className="managed-membership-list">{memberships.length === 0 ? <p className="muted-empty">No members assigned yet.</p> : memberships.map((membership) => <article key={membership.userId}><div><strong>{membership.name || membership.email}</strong><p>{membership.email}</p></div><Form method="post"><input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={membership.userId} /><select aria-label={`Role for ${membership.name || membership.email}`} defaultValue={membership.role} name="role" onChange={(event) => event.currentTarget.form?.requestSubmit()}>{organizationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></Form><Form method="post" onSubmit={(event) => { if (!window.confirm(`Remove ${membership.name || membership.email} from ${organization.name}?`)) event.preventDefault(); }}><input name="intent" type="hidden" value="remove-membership" /><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={membership.userId} /><button className="member-action-button member-action-button--suspend" type="submit">Remove</button></Form></article>)}</div>
				</div>
			</section>

			{loaderData.canManageLifecycle && <p className="managed-lifecycle-link">Site administrators can change lifecycle status and URL slugs in <Link to="/admin/organizations">organization administration</Link>.</p>}
		</div>
	);
}
