import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/organization-manage";
import { Icon } from "~/components/icon";
import { OrganizationIdentity } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { deleteIdentityImage, ImageUploadError, requireUploadRequestSize, uploadIdentityImage } from "~/lib/media.server";
import { organizationRoles } from "~/lib/organizations";
import {
	getOrganizationManagementData,
	OrganizationMutationError,
	removeOrganizationMembership,
	setOrganizationMembership,
	updateManagedOrganizationProfile,
	updateOrganizationLogo,
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
const actionSchema = z.discriminatedUnion("intent", [
	z.object({
		intent: z.literal("update-profile"),
		organizationId: identifier,
		name: z.string().trim().min(2, "Enter an organization name").max(120),
		summary: optionalText(240),
		description: optionalText(4000),
		websiteUrl: optionalUrl,
		contactEmail: optionalEmail,
	}),
	z.object({ intent: z.literal("set-membership"), organizationId: identifier, userId: identifier, role: z.enum(organizationRoles) }),
	z.object({ intent: z.literal("remove-membership"), organizationId: identifier, userId: identifier }),
	z.object({ intent: z.literal("remove-logo"), organizationId: identifier }),
]);

const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `Manage ${data?.organization.name ?? "organization"} · State of Queer NH` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	try {
		const data = await getOrganizationManagementData(context.cloudflare.env, user, params.slug);
		if (!data) throw new Response("Organization not found", { status: 404 });
		return data;
	} catch (error) {
		if (error instanceof OrganizationMutationError) {
			throw new Response(error.reason === "not-found" ? "Organization not found" : "Forbidden", {
				status: error.reason === "not-found" ? 404 : 403,
			});
		}
		throw error;
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	try {
		requireUploadRequestSize(request);
	} catch (error) {
		if (error instanceof ImageUploadError) return { ok: false as const, error: "Upload an image smaller than 2 MB." };
		throw error;
	}
	const formData = await request.formData();
	const result = actionSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) {
		return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the organization details" };
	}

	try {
		if (result.data.intent === "update-profile") {
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
			const message = error.reason === "too-large" ? "Upload an image smaller than 2 MB." : error.reason === "unsupported" ? "Upload a PNG, JPG, WebP, or GIF image." : "The uploaded file does not appear to be a valid image.";
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

	return (
		<div className="organization-manage-page">
			<section className="page-heading">
				<div><p className="eyebrow">Organization workspace</p><h1>Manage {organization.name}</h1><p>Keep the public profile current and manage the people who participate through this organization.</p></div>
				<Link className="button button--secondary heading-action" to={`/organizations/${organization.slug}`}><Icon name="building" size={17} /> View profile</Link>
			</section>
			{actionData && <p className={`admin-notice form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}

			<section className="panel managed-profile-panel">
				<div className="panel-heading"><div><p className="eyebrow">Public information</p><h2>Organization profile</h2></div><span className={`status-pill status-pill--${organization.status}`}>{organization.status}</span></div>
				<div className="organization-logo-editor"><OrganizationIdentity large logoObjectKey={organization.logoObjectKey} name={organization.name} /><div><strong>Organization logo</strong><p>PNG, JPG, WebP, or GIF. Maximum 2 MB.</p>{organization.logoObjectKey && <Form method="post"><input name="intent" type="hidden" value="remove-logo" /><input name="organizationId" type="hidden" value={organization.id} /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Remove logo</button></Form>}</div></div>
				<Form className="organization-edit-form" encType="multipart/form-data" method="post">
					<input name="intent" type="hidden" value="update-profile" /><input name="organizationId" type="hidden" value={organization.id} />
					<label>Organization logo<input accept="image/png,image/jpeg,image/webp,image/gif" name="logo" type="file" /></label>
					<label>Name<input defaultValue={organization.name} name="name" required /></label>
					<label>Website<input defaultValue={organization.websiteUrl ?? ""} name="websiteUrl" type="url" /></label>
					<label className="wide-field">Short summary<input defaultValue={organization.summary ?? ""} maxLength={240} name="summary" /></label>
					<label className="wide-field">Full description<textarea defaultValue={organization.description ?? ""} maxLength={4000} name="description" rows={5} /></label>
					<label>Contact email<input defaultValue={organization.contactEmail ?? ""} name="contactEmail" type="email" /></label>
					<button className="button button--primary" disabled={submitting} type="submit">Save profile</button>
				</Form>
				<div className="managed-affiliation-note"><div><p className="eyebrow">Visibility network</p><h3>Affiliations</h3></div>{organization.affiliations.length === 0 ? <p>No affiliations are assigned. A site administrator must connect this organization before it becomes discoverable through the network.</p> : <div className="affiliation-chip-row">{organization.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>}<small>Affiliations control access and can only be changed by a site administrator.</small></div>
			</section>

			<section className="panel managed-members-panel">
				<div className="panel-heading"><div><p className="eyebrow">Participation</p><h2>Organization members</h2></div><span>{memberships.length}</span></div>
				<div className="organization-membership-manager">
					<Form className="membership-add-form" method="post">
						<input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} />
						<select aria-label="Member" name="userId" required><option value="">Select an active member</option>{loaderData.availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}</select>
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
