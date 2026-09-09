import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/profile";
import { IdentityAvatar, OrganizationIdentity } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { deleteIdentityImage, ImageUploadError, requireUploadRequestSize, uploadIdentityImage } from "~/lib/media.server";
import { cancelOrganizationClaimSchema, organizationRoleLabels, submitOrganizationClaimSchema } from "~/lib/organization-claims";
import { cancelAffiliationRequestSchema, submitAffiliationRequestSchema } from "~/lib/affiliation-requests";
import { organizationRoles } from "~/lib/organizations";
import { cancelOrganizationClaim, listClaimableOrganizations, listOwnOrganizationClaims, OrganizationClaimMutationError, submitOrganizationClaim } from "~/models/organization-claims.server";
import { AffiliationRequestMutationError, cancelAffiliationRequest, listOwnAffiliationRequests, listRequestableAffiliations, submitAffiliationRequest } from "~/models/affiliation-requests.server";
import { getOwnProfileEditorData, isOwnProfileComplete, updateOwnProfile } from "~/models/profiles.server";

const optionalText = (maximum: number) => z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : null,
	z.string().max(maximum).nullable(),
);
const profileSchema = z.object({
	intent: z.literal("update-profile"),
	name: z.string().trim().min(2, "Enter the name members should see").max(120),
	profileTitle: optionalText(160),
	pronouns: optionalText(80),
	bio: optionalText(2000),
	location: optionalText(160),
	websiteUrl: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : null,
		z.url("Enter a complete website URL").max(500).nullable(),
	),
	profileVisibility: z.enum(["members", "hidden"]),
});

function uploadMessage(error: ImageUploadError) {
	return error.reason === "too-large" ? "Upload an image smaller than 10 MB."
		: error.reason === "unsupported" ? "Upload a PNG, JPG, WebP, or GIF image."
		: "The uploaded file does not appear to be a valid image.";
}

export function meta() {
	return [{ title: "Edit profile · NH Connect" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const [data, claimableOrganizations, organizationClaims, requestableAffiliations, affiliationRequests, profileComplete] = await Promise.all([
		getOwnProfileEditorData(context.cloudflare.env, user),
		listClaimableOrganizations(context.cloudflare.env, user),
		listOwnOrganizationClaims(context.cloudflare.env, user),
		listRequestableAffiliations(context.cloudflare.env, user),
		listOwnAffiliationRequests(context.cloudflare.env, user),
		isOwnProfileComplete(context.cloudflare.env, user),
	]);
	if (!data.profile) throw new Response("Profile not found", { status: 404 });
	return {
		user,
		profile: data.profile,
		claimableOrganizations,
		organizationClaims,
		requestableAffiliations,
		affiliationRequests,
		onboarding: !profileComplete,
	};
}

function claimErrorMessage(error: OrganizationClaimMutationError) {
	return {
		"organization-unavailable": "That organization is not currently accepting membership claims.",
		"same-role": "You already have that role in this organization.",
		"already-pending": "You already have a pending claim for this organization.",
		"claim-unavailable": "That membership claim is no longer available.",
		"already-reviewed": "That membership claim has already been reviewed.",
		forbidden: "You do not have permission to change that membership claim.",
		"self-review": "You cannot review your own membership claim.",
		"member-unavailable": "The member or organization is no longer active.",
	}[error.reason];
}

function affiliationRequestErrorMessage(error: AffiliationRequestMutationError) {
	return {
		"affiliation-unavailable": "That affiliation is no longer available.",
		"already-member": "You already have access to that affiliation.",
		"already-pending": "You already have a pending request for that affiliation.",
		"request-unavailable": "That affiliation request is no longer available.",
		"already-reviewed": "That affiliation request has already been reviewed.",
		forbidden: "You do not have permission to change that affiliation request.",
		"self-review": "You cannot review your own affiliation request.",
		"member-unavailable": "The member or affiliation is no longer active.",
	}[error.reason];
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	try {
		requireUploadRequestSize(request);
		const formData = await request.formData();
		const editor = await getOwnProfileEditorData(context.cloudflare.env, user);
		if (!editor.profile) throw new Response("Profile not found", { status: 404 });
		const intent = formData.get("intent");
		const profileComplete = await isOwnProfileComplete(context.cloudflare.env, user);
		if (!profileComplete && intent !== "update-profile") {
			return { ok: false as const, error: "Complete your profile before continuing." };
		}
		if (intent === "submit-organization-claim") {
			const parsed = submitOrganizationClaimSchema.safeParse(Object.fromEntries(formData));
			if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the organization claim." };
			await submitOrganizationClaim(context.cloudflare.env, user, parsed.data);
			return { ok: true as const, message: "Organization claim submitted for approval." };
		}
		if (intent === "cancel-organization-claim") {
			const parsed = cancelOrganizationClaimSchema.safeParse(Object.fromEntries(formData));
			if (!parsed.success) return { ok: false as const, error: "That membership claim is unavailable." };
			await cancelOrganizationClaim(context.cloudflare.env, user, parsed.data.claimId);
			return { ok: true as const, message: "Organization claim cancelled." };
		}
		if (intent === "submit-affiliation-request") {
			const parsed = submitAffiliationRequestSchema.safeParse(Object.fromEntries(formData));
			if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Choose an affiliation." };
			await submitAffiliationRequest(context.cloudflare.env, user, parsed.data.affiliationId);
			return { ok: true as const, message: "Affiliation request submitted for administrator approval." };
		}
		if (intent === "cancel-affiliation-request") {
			const parsed = cancelAffiliationRequestSchema.safeParse(Object.fromEntries(formData));
			if (!parsed.success) return { ok: false as const, error: "That affiliation request is unavailable." };
			await cancelAffiliationRequest(context.cloudflare.env, user, parsed.data.requestId);
			return { ok: true as const, message: "Affiliation request cancelled." };
		}
		if (intent === "remove-avatar") {
			await updateOwnProfile(context.cloudflare.env, user, {
				name: editor.profile.name ?? "Member",
				profileTitle: editor.profile.profileTitle,
				pronouns: editor.profile.pronouns,
				bio: editor.profile.bio,
				location: editor.profile.location,
				websiteUrl: editor.profile.websiteUrl,
				profileVisibility: editor.profile.profileVisibility,
				avatarObjectKey: null,
			});
			context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, editor.profile.avatarObjectKey));
			return { ok: true as const, message: "Profile photo removed." };
		}
		const parsed = profileSchema.safeParse(Object.fromEntries(formData));
		if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check your profile details." };
		const newAvatarKey = await uploadIdentityImage(context.cloudflare.env, formData.get("avatar"), "profile-photos", user.id);
		try {
			await updateOwnProfile(context.cloudflare.env, user, {
				...parsed.data,
				avatarObjectKey: newAvatarKey ?? editor.profile.avatarObjectKey,
			});
		} catch (error) {
			if (newAvatarKey) await deleteIdentityImage(context.cloudflare.env, newAvatarKey);
			throw error;
		}
		if (newAvatarKey && editor.profile.avatarObjectKey) context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, editor.profile.avatarObjectKey));
		if (!profileComplete) throw redirect("/");
		return { ok: true as const, message: "Profile updated." };
	} catch (error) {
		if (error instanceof Response) throw error;
		if (error instanceof ImageUploadError) return { ok: false as const, error: uploadMessage(error) };
		if (error instanceof OrganizationClaimMutationError) return { ok: false as const, error: claimErrorMessage(error) };
		if (error instanceof AffiliationRequestMutationError) return { ok: false as const, error: affiliationRequestErrorMessage(error) };
		console.error(JSON.stringify({ message: "profile update failed", actorUserId: user.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "Your profile could not be saved." };
	}
}

export default function Profile({ loaderData }: Route.ComponentProps) {
	const { profile } = loaderData;
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	return <div className={`profile-edit-page${loaderData.onboarding ? " profile-edit-page--onboarding" : ""}`}><section className="page-heading"><div><p className="eyebrow">{loaderData.onboarding ? "Welcome to the community" : "Your profile"}</p><h1>{loaderData.onboarding ? "Complete your profile" : "Edit profile"}</h1><p>{loaderData.onboarding ? "Tell other members a little about you before entering the workspace. You can change these details at any time." : "Choose how you appear to collaborators across the member network."}</p></div>{!loaderData.onboarding && <Link className="button button--secondary" to={`/members/${profile.id}`}>View profile</Link>}</section>
		{actionData && <p className={`form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}
		<section className="panel profile-editor-panel"><div className="profile-photo-editor"><IdentityAvatar name={profile.name} objectKey={profile.avatarObjectKey} size="large" /><div><strong>Profile photo</strong><p>PNG, JPG, WebP, or GIF. Maximum 10 MB.</p>{profile.avatarObjectKey && <Form method="post"><input name="intent" type="hidden" value="remove-avatar" /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Remove photo</button></Form>}</div></div>
			<Form className="profile-editor-form" encType="multipart/form-data" method="post"><input name="intent" type="hidden" value="update-profile" />
				<label>Profile photo<input accept="image/png,image/jpeg,image/webp,image/gif" name="avatar" type="file" /></label><label>Name<input defaultValue={profile.name ?? ""} maxLength={120} name="name" required /></label><label>Role or title<input defaultValue={profile.profileTitle ?? ""} maxLength={160} name="profileTitle" placeholder="Organizer, policy lead, volunteer coordinator…" /></label><label>Pronouns<input defaultValue={profile.pronouns ?? ""} maxLength={80} name="pronouns" /></label><label>Location<input defaultValue={profile.location ?? ""} maxLength={160} name="location" /></label><label>Website<input defaultValue={profile.websiteUrl ?? ""} maxLength={500} name="websiteUrl" type="url" /></label><label>Directory visibility<select defaultValue={profile.profileVisibility} name="profileVisibility"><option value="members">Visible to all signed-in members</option><option value="hidden">Hidden from the member directory</option></select></label><label className="wide-field">Bio<textarea defaultValue={profile.bio ?? ""} maxLength={2000} name="bio" rows={6} /></label>
				<button className="button button--primary" disabled={submitting} type="submit">{submitting ? "Saving…" : loaderData.onboarding ? "Save profile and continue" : "Save profile"}</button>
			</Form>
		</section>
		{!loaderData.onboarding && <section className="panel profile-organization-panel">
			<div className="panel-heading"><div><p className="eyebrow">Community roles</p><h2>Your organizations</h2></div><span>{profile.organizations.length}</span></div>
			{profile.organizations.length === 0 ? <p className="muted-empty">You do not have an approved organization membership yet.</p> : <div className="member-organization-list">{profile.organizations.map((organization) => <Link key={organization.id} to={`/organizations/${organization.slug}`}><OrganizationIdentity logoObjectKey={organization.logoObjectKey} name={organization.name} /><div><strong>{organization.name}</strong><p>{organizationRoleLabels[organization.role]}</p></div><span className="status-pill status-pill--active">Approved</span></Link>)}</div>}
			<div className="profile-claim-workflow">
				<div><p className="eyebrow">Request access</p><h3>Claim an organization or role</h3><p>Choose the role you perform. A site administrator or an administrator for that organization must approve it before your access changes.</p></div>
				<Form className="profile-claim-form" method="post">
					<input name="intent" type="hidden" value="submit-organization-claim" />
					<label>Organization<select name="organizationId" required><option value="">Select an organization</option>{loaderData.claimableOrganizations.map((organization) => <option disabled={organization.hasPendingClaim} key={organization.id} value={organization.id}>{organization.name}{organization.currentRole ? ` · current: ${organizationRoleLabels[organization.currentRole]}` : ""}{organization.hasPendingClaim ? " · pending" : ""}</option>)}</select></label>
					<label>Requested role<select defaultValue="viewer" name="requestedRole">{organizationRoles.map((role) => <option key={role} value={role}>{organizationRoleLabels[role]}</option>)}</select></label>
					<button className="button button--primary button--compact" disabled={submitting} type="submit">Submit claim</button>
				</Form>
			</div>
			{loaderData.organizationClaims.length > 0 && <div className="profile-claim-history"><h3>Claim history</h3>{loaderData.organizationClaims.map((claim) => <article key={claim.id}><div><strong>{claim.organizationName}</strong><p>{organizationRoleLabels[claim.requestedRole]} · submitted {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(claim.createdAt))}</p>{claim.reviewReason && <small>{claim.reviewReason}</small>}</div><span className={`status-pill status-pill--${claim.status}`}>{claim.status}</span>{claim.status === "pending" && <Form method="post"><input name="intent" type="hidden" value="cancel-organization-claim" /><input name="claimId" type="hidden" value={claim.id} /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Cancel</button></Form>}</article>)}</div>}
		</section>}
		{!loaderData.onboarding && <section className="panel profile-organization-panel">
			<div className="panel-heading"><div><p className="eyebrow">Coalition spaces</p><h2>Your affiliations</h2></div><span>{profile.affiliations.length}</span></div>
			{profile.affiliations.length === 0 ? <p className="muted-empty">You do not have approved affiliation access yet.</p> : <div className="affiliation-chip-row">{profile.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>}
			<div className="profile-claim-workflow">
				<div><p className="eyebrow">Request access</p><h3>Join an affiliation</h3><p>Affiliations provide access to coalition-specific posts, projects, and events. A site administrator must approve your request before access is added.</p></div>
				<Form className="profile-claim-form profile-claim-form--single" method="post">
					<input name="intent" type="hidden" value="submit-affiliation-request" />
					<label>Affiliation<select name="affiliationId" required><option value="">Select an affiliation</option>{loaderData.requestableAffiliations.map((affiliation) => <option disabled={affiliation.hasEffectiveAccess || affiliation.hasPendingRequest} key={affiliation.id} value={affiliation.id}>{affiliation.name}{affiliation.hasDirectAccess ? " · approved" : affiliation.hasEffectiveAccess ? " · access through organization" : affiliation.hasPendingRequest ? " · pending" : ""}</option>)}</select></label>
					<button className="button button--primary button--compact" disabled={submitting} type="submit">Request affiliation</button>
				</Form>
			</div>
			{loaderData.affiliationRequests.length > 0 && <div className="profile-claim-history"><h3>Request history</h3>{loaderData.affiliationRequests.map((request) => <article key={request.id}><div><strong>{request.affiliationName}</strong><p>Submitted {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(request.createdAt))}</p>{request.reviewReason && <small>{request.reviewReason}</small>}</div><span className={`status-pill status-pill--${request.status}`}>{request.status}</span>{request.status === "pending" && <Form method="post"><input name="intent" type="hidden" value="cancel-affiliation-request" /><input name="requestId" type="hidden" value={request.id} /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Cancel</button></Form>}</article>)}</div>}
		</section>}
	</div>;
}
