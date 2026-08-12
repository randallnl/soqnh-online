import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-organizations";
import { Icon } from "~/components/icon";
import { requireSiteAdmin } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import {
	organizationRoles,
	organizationStatuses,
	slugifyOrganizationName,
} from "~/lib/organizations";
import {
	createOrganization,
	getOrganizationAdministrationData,
	OrganizationMutationError,
	removeOrganizationMembership,
	setOrganizationMembership,
	updateOrganization,
} from "~/models/organizations.server";

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
const organizationFields = z.object({
	name: z.string().trim().min(2, "Enter an organization name").max(120),
	slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens").max(80),
	summary: optionalText(240),
	websiteUrl: optionalUrl,
	contactEmail: optionalEmail,
});
const actionSchema = z.discriminatedUnion("intent", [
	organizationFields.extend({ intent: z.literal("create") }),
	organizationFields.extend({
		intent: z.literal("update"),
		organizationId: identifier,
		description: optionalText(4000),
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
]);

const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Organization administration · State of Queer NH" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireSiteAdmin(request, context.cloudflare.env);
	return getOrganizationAdministrationData(context.cloudflare.env);
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const formData = await request.formData();
	const raw = Object.fromEntries(formData);
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

			<section className="panel organization-create-panel">
				<div className="panel-heading"><div><p className="eyebrow">New profile</p><h2>Add an organization</h2></div></div>
				<Form className="organization-create-form" method="post">
					<input name="intent" type="hidden" value="create" />
					<label>Name<input name="name" required placeholder="Organization name" /></label>
					<label>URL slug<input name="slug" placeholder="generated-from-name" /></label>
					<label className="wide-field">Short summary<input name="summary" maxLength={240} placeholder="What this organization does" /></label>
					<label>Website<input name="websiteUrl" type="url" placeholder="https://example.org" /></label>
					<label>Contact email<input name="contactEmail" type="email" placeholder="hello@example.org" /></label>
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
								<div><strong>{organization.name}</strong><p>/{organization.slug} · {organization.memberCount} members</p></div>
								<span className={`status-pill status-pill--${organization.status}`}>{organization.status}</span>
								<Icon name="chevron-right" size={18} />
							</summary>
							<div className="organization-admin-body">
								<Form className="organization-edit-form" method="post">
									<input name="intent" type="hidden" value="update" /><input name="organizationId" type="hidden" value={organization.id} />
									<label>Name<input defaultValue={organization.name} name="name" required /></label>
									<label>URL slug<input defaultValue={organization.slug} name="slug" required /></label>
									<label>Status<select defaultValue={organization.status} name="status">{organizationStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
									<label className="wide-field">Short summary<input defaultValue={organization.summary ?? ""} maxLength={240} name="summary" /></label>
									<label className="wide-field">Full description<textarea defaultValue={organization.description ?? ""} maxLength={4000} name="description" rows={4} /></label>
									<label>Website<input defaultValue={organization.websiteUrl ?? ""} name="websiteUrl" type="url" /></label>
									<label>Contact email<input defaultValue={organization.contactEmail ?? ""} name="contactEmail" type="email" /></label>
									<button className="button button--secondary" disabled={submitting} type="submit">Save profile</button>
								</Form>

								<div className="organization-membership-manager">
									<div className="subsection-heading"><div><p className="eyebrow">Access roles</p><h3>Members</h3></div><Link to={`/organizations/${organization.slug}`}>Open profile</Link></div>
									<Form className="membership-add-form" method="post">
										<input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} />
										<select aria-label="Member" name="userId" required><option value="">Select an active member</option>{loaderData.availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}</select>
										<select aria-label="Role" defaultValue="viewer" name="role">{organizationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>
										<button className="button button--primary button--compact" type="submit">Add or update</button>
									</Form>
									<div className="managed-membership-list">
										{memberships.length === 0 ? <p className="muted-empty">No members assigned yet.</p> : memberships.map((membership) => (
											<article key={membership.userId}><div><strong>{membership.name || membership.email}</strong><p>{membership.email}</p></div><Form method="post"><input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={membership.userId} /><select aria-label={`Role for ${membership.name || membership.email}`} defaultValue={membership.role} name="role" onChange={(event) => event.currentTarget.form?.requestSubmit()}>{organizationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></Form><Form method="post" onSubmit={(event) => { if (!window.confirm(`Remove ${membership.name || membership.email} from ${organization.name}?`)) event.preventDefault(); }}><input name="intent" type="hidden" value="remove-membership" /><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={membership.userId} /><button className="member-action-button member-action-button--suspend" type="submit">Remove</button></Form></article>
										))}
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
