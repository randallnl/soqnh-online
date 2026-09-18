import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-organization-detail";
import { OrganizationProfileFields } from "~/components/organization-profile-fields";
import { requireSiteAdmin } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { deleteIdentityImage } from "~/lib/media.server";
import { serializeOrganizationCategories } from "~/lib/organization-categories";
import { organizationRoles, organizationStatuses } from "~/lib/organizations";
import {
	deleteOrganization,
	getOrganizationManagementData,
	OrganizationMutationError,
	removeOrganizationMembership,
	setOrganizationMembership,
	updateOrganization,
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
const updateSchema = z.object({
	intent: z.literal("update"),
	organizationId: identifier,
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
	status: z.enum(organizationStatuses),
});
const membershipSchema = z.discriminatedUnion("intent", [
	z.object({ intent: z.literal("set-membership"), organizationId: identifier, userId: identifier, role: z.enum(organizationRoles) }),
	z.object({ intent: z.literal("remove-membership"), organizationId: identifier, userId: identifier }),
	z.object({ intent: z.literal("delete-organization"), organizationId: identifier }),
]);
const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.organization.name ?? "Organization"} administration · NH Connect` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const data = await getOrganizationManagementData(context.cloudflare.env, admin, params.slug);
	if (!data) throw new Response("Organization not found", { status: 404 });
	const url = new URL(request.url);
	return { ...data, saved: url.searchParams.has("saved"), created: url.searchParams.has("created") };
}

export async function action({ request, context, params }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const data = await getOrganizationManagementData(context.cloudflare.env, admin, params.slug);
	if (!data) throw new Response("Organization not found", { status: 404 });
	const formData = await request.formData();
	const raw = Object.fromEntries(formData);
	const intent = typeof raw.intent === "string" ? raw.intent : "";
	if (raw.organizationId !== data.organization.id) return { ok: false as const, intent, error: "This organization changed. Reload the page and try again." };
	if (intent === "update") raw.category = serializeOrganizationCategories(formData.getAll("category"));
	const parsed = intent === "update" ? updateSchema.safeParse(raw) : membershipSchema.safeParse(raw);
	if (!parsed.success) return { ok: false as const, intent, error: parsed.error.issues[0]?.message ?? "Check the submitted details." };

	try {
		if (parsed.data.intent === "update") {
			await updateOrganization(context.cloudflare.env, admin, parsed.data);
			if (parsed.data.slug !== params.slug) return redirect(`/admin/organizations/${parsed.data.slug}?saved=1`);
			return { ok: true as const, intent, message: "Organization profile updated." };
		}
		if (parsed.data.intent === "set-membership") {
			await setOrganizationMembership(context.cloudflare.env, admin, parsed.data);
			return { ok: true as const, intent, message: "Organization membership updated." };
		}
		if (parsed.data.intent === "remove-membership") {
			await removeOrganizationMembership(context.cloudflare.env, admin, parsed.data);
			return { ok: true as const, intent, message: "Member removed from the organization." };
		}
		const deleted = await deleteOrganization(context.cloudflare.env, admin, parsed.data.organizationId);
		if (deleted.logoObjectKey) context.cloudflare.ctx.waitUntil(deleteIdentityImage(context.cloudflare.env, deleted.logoObjectKey));
		return redirect("/admin/organizations?deleted=1");
	} catch (error) {
		if (error instanceof OrganizationMutationError) {
			const messages = {
				"not-found": "That organization is no longer available.",
				"slug-conflict": "That organization URL slug is already in use.",
				"member-unavailable": "Only active members can be assigned to an organization.",
				"membership-not-found": "That membership has already been removed.",
				forbidden: "You no longer have permission to manage that organization.",
				"self-management": "Organization administrators cannot remove or demote their own access.",
				"directory-transition": "The NH Connect public directory status changed. Refresh and try again.",
			};
			return { ok: false as const, intent, error: messages[error.reason] };
		}
		console.error(JSON.stringify({ message: "organization administration failed", actorUserId: admin.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, intent, error: "The organization change could not be saved." };
	}
}

export default function AdminOrganizationDetail({ loaderData }: Route.ComponentProps) {
	const { organization, memberships, availableMembers, saved, created } = loaderData;
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	return <div className="admin-page organization-admin-page">
		<section className="page-heading"><div><p className="eyebrow"><Link to="/admin/organizations">← Organization administration</Link></p><h1>{organization.name}</h1><p>Manage this organization's profile and member access.</p></div><Link className="button button--secondary heading-action" to={`/organizations/${organization.slug}`}>View profile</Link></section>
		<div className="panel organization-admin-body organization-admin-body--detail">
			<Form className="organization-edit-form" method="post">
				<input name="intent" type="hidden" value="update" /><input name="organizationId" type="hidden" value={organization.id} />
				<OrganizationProfileFields organization={organization} />
				<label>URL slug<input defaultValue={organization.slug} name="slug" required /></label>
				<label>Status<select defaultValue={organization.status} name="status">{organizationStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
				{(saved || created || actionData?.intent === "update") && <p role="status" className={`form-message form-message--${actionData?.ok === false ? "error" : "success"}`}>{actionData?.intent === "update" ? (actionData.ok ? actionData.message : actionData.error) : created ? "Organization created." : "Organization profile updated."}</p>}
				<button className="button button--secondary" disabled={submitting} type="submit">Save profile</button>
			</Form>
			<div className="organization-membership-manager">
				<div className="subsection-heading"><div><p className="eyebrow">Access roles</p><h2>Members</h2></div></div>
				<Form className="membership-add-form" method="post">
					<input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} />
					<select aria-label="Member" name="userId" required><option value="">Select an active member</option>{availableMembers.map((member) => <option key={member.id} value={member.id}>{member.name ? `${member.name} — ${member.email}` : member.email}</option>)}</select>
					<select aria-label="Role" defaultValue="viewer" name="role">{organizationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>
					<button className="button button--primary button--compact" disabled={submitting} type="submit">Add or update</button>
				</Form>
				{actionData && actionData.intent !== "update" && actionData.intent !== "delete-organization" && <p role="status" className={`form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}
				<div className="managed-membership-list">
					{memberships.length === 0 ? <p className="muted-empty">No members assigned yet.</p> : memberships.map((membership) => <article key={membership.userId}><div><strong>{membership.name || membership.email}</strong><p>{membership.email}</p></div><Form method="post"><input name="intent" type="hidden" value="set-membership" /><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={membership.userId} /><select aria-label={`Role for ${membership.name || membership.email}`} defaultValue={membership.role} name="role" onChange={(event) => event.currentTarget.form?.requestSubmit()}>{organizationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></Form><Form method="post" onSubmit={(event) => { if (!window.confirm(`Remove ${membership.name || membership.email} from ${organization.name}?`)) event.preventDefault(); }}><input name="intent" type="hidden" value="remove-membership" /><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={membership.userId} /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Remove</button></Form></article>)}
				</div>
				<div className="organization-danger-zone"><div><strong>Delete organization</strong><p>Permanently remove this profile, memberships, claims, and affiliation links. Existing posts and events will remain without organization attribution.</p></div><Form method="post" onSubmit={(event) => { if (!window.confirm(`Permanently delete ${organization.name}? This cannot be undone.`)) event.preventDefault(); }}><input name="intent" type="hidden" value="delete-organization" /><input name="organizationId" type="hidden" value={organization.id} /><button className="member-action-button member-action-button--delete" disabled={submitting} type="submit">Delete organization</button></Form></div>
				{actionData?.intent === "delete-organization" && !actionData.ok && <p role="alert" className="form-message form-message--error">{actionData.error}</p>}
			</div>
		</div>
	</div>;
}
