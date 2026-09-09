import { Form, Link, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-affiliations";
import { Icon } from "~/components/icon";
import { slugifyAffiliationName } from "~/lib/affiliations";
import { reviewAffiliationRequestSchema } from "~/lib/affiliation-requests";
import { requireSiteAdmin } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import {
	addOrganizationAffiliation,
	addUserAffiliation,
	AffiliationMutationError,
	createAffiliation,
	getAffiliationAdministrationData,
	removeOrganizationAffiliation,
	removeUserAffiliation,
	updateAffiliation,
} from "~/models/affiliations.server";
import { AffiliationRequestMutationError, listPendingAffiliationRequests, reviewAffiliationRequest } from "~/models/affiliation-requests.server";

const identifier = z.string().trim().min(1).max(100);
const affiliationFields = z.object({
	name: z.string().trim().min(2, "Enter an affiliation name").max(120),
	slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens").max(80),
});
const actionSchema = z.discriminatedUnion("intent", [
	affiliationFields.extend({ intent: z.literal("create") }),
	affiliationFields.extend({ intent: z.literal("update"), affiliationId: identifier }),
	z.object({ intent: z.literal("add-organization"), affiliationId: identifier, organizationId: identifier }),
	z.object({ intent: z.literal("remove-organization"), affiliationId: identifier, organizationId: identifier }),
	z.object({ intent: z.literal("add-user"), affiliationId: identifier, userId: identifier }),
	z.object({ intent: z.literal("remove-user"), affiliationId: identifier, userId: identifier }),
]);

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Affiliation administration · NH Connect" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireSiteAdmin(request, context.cloudflare.env);
	const [administration, pendingRequests] = await Promise.all([
		getAffiliationAdministrationData(context.cloudflare.env),
		listPendingAffiliationRequests(context.cloudflare.env),
	]);
	return { ...administration, pendingRequests };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const admin = await requireSiteAdmin(request, context.cloudflare.env);
	const raw = Object.fromEntries(await request.formData());
	if ((raw.intent === "create" || raw.intent === "update") && !raw.slug && typeof raw.name === "string") {
		raw.slug = slugifyAffiliationName(raw.name);
	}
	if (raw.intent === "review-affiliation-request") {
		const review = reviewAffiliationRequestSchema.safeParse(raw);
		if (!review.success) return { ok: false as const, error: review.error.issues[0]?.message ?? "Check the affiliation request decision." };
		try {
			await reviewAffiliationRequest(context.cloudflare.env, admin, { requestId: review.data.requestId, decision: review.data.decision, reason: review.data.reason });
			return { ok: true as const, message: review.data.decision === "approve" ? "Affiliation request approved." : "Affiliation request rejected." };
		} catch (error) {
			if (error instanceof AffiliationRequestMutationError) {
				const messages = { "affiliation-unavailable": "That affiliation is no longer available.", "already-member": "That member already has affiliation access.", "already-pending": "That request is already pending.", "request-unavailable": "That affiliation request is no longer available.", "already-reviewed": "Another administrator already reviewed that request.", forbidden: "Only site administrators can review affiliation requests.", "self-review": "You cannot approve your own affiliation request.", "member-unavailable": "The member or affiliation is no longer active." };
				return { ok: false as const, error: messages[error.reason] };
			}
			console.error(JSON.stringify({ message: "affiliation request review failed", actorUserId: admin.id, error: error instanceof Error ? error.message : String(error) }));
			return { ok: false as const, error: "The affiliation request could not be reviewed." };
		}
	}
	const result = actionSchema.safeParse(raw);
	if (!result.success) {
		return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the affiliation details" };
	}

	try {
		switch (result.data.intent) {
			case "create":
				await createAffiliation(context.cloudflare.env, admin, result.data);
				return { ok: true as const, message: "Affiliation created." };
			case "update":
				await updateAffiliation(context.cloudflare.env, admin, result.data);
				return { ok: true as const, message: "Affiliation updated." };
			case "add-organization":
				await addOrganizationAffiliation(context.cloudflare.env, admin, result.data);
				return { ok: true as const, message: "Organization affiliation added." };
			case "remove-organization":
				await removeOrganizationAffiliation(context.cloudflare.env, admin, result.data);
				return { ok: true as const, message: "Organization affiliation removed." };
			case "add-user":
				await addUserAffiliation(context.cloudflare.env, admin, result.data);
				return { ok: true as const, message: "Direct member affiliation added." };
			case "remove-user":
				await removeUserAffiliation(context.cloudflare.env, admin, result.data);
				return { ok: true as const, message: "Direct member affiliation removed." };
		}
	} catch (error) {
		if (error instanceof AffiliationMutationError) {
			const messages = {
				"not-found": "That affiliation is no longer available.",
				"slug-conflict": "That affiliation URL slug is already in use.",
				"name-conflict": "That affiliation name is already in use.",
				"organization-unavailable": "Archived or missing organizations cannot be assigned.",
				"member-unavailable": "Only active members can receive a direct affiliation.",
				"link-not-found": "That affiliation link has already been removed.",
				"forbidden": "Only site administrators can change affiliations.",
			};
			return { ok: false as const, error: messages[error.reason] };
		}
		console.error(JSON.stringify({ message: "affiliation administration failed", actorUserId: admin.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "The affiliation change could not be saved." };
	}
}

export default function AdminAffiliations({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";

	return (
		<div className="admin-page affiliation-admin-page">
			<section className="page-heading">
				<div><p className="eyebrow">Site administration</p><h1>Affiliations</h1><p>Manage coalitions and shared networks that determine which organizations members can discover.</p></div>
				<Link className="button button--secondary heading-action" to="/admin/organizations"><Icon name="building" size={17} /> Organizations</Link>
			</section>
			{actionData && <p className={`admin-notice form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}

			<section className="panel organization-claim-review-panel" id="affiliation-requests">
				<div className="panel-heading"><div><p className="eyebrow">Access moderation</p><h2>Affiliation requests</h2></div><span>{loaderData.pendingRequests.length}</span></div>
				{loaderData.pendingRequests.length === 0 ? <p className="muted-empty">No affiliation requests are awaiting review.</p> : <div className="organization-claim-review-list">{loaderData.pendingRequests.map((request) => <article key={request.id}><div><strong>{request.userName || request.userEmail}</strong><p>{request.userName ? `${request.userEmail} · ` : ""}Requests access to {request.affiliationName}</p></div><div className="organization-claim-actions"><Form method="post"><input name="intent" type="hidden" value="review-affiliation-request" /><input name="requestId" type="hidden" value={request.id} /><input name="decision" type="hidden" value="approve" /><button className="button button--primary button--compact" disabled={submitting} type="submit">Approve</button></Form><Form className="organization-claim-reject-form" method="post"><input name="intent" type="hidden" value="review-affiliation-request" /><input name="requestId" type="hidden" value={request.id} /><input name="decision" type="hidden" value="reject" /><input aria-label={`Reason for rejecting ${request.userName || request.userEmail}`} maxLength={500} name="reason" placeholder="Reason for rejection" required /><button className="member-action-button member-action-button--suspend" disabled={submitting} type="submit">Reject</button></Form></div></article>)}</div>}
			</section>

			<section className="panel organization-create-panel">
				<div className="panel-heading"><div><p className="eyebrow">New network</p><h2>Add an affiliation</h2></div></div>
				<Form className="affiliation-create-form" method="post">
					<input name="intent" type="hidden" value="create" />
					<label>Name<input name="name" required placeholder="Coalition or network name" /></label>
					<label>URL slug<input name="slug" placeholder="generated-from-name" /></label>
					<button className="button button--primary" disabled={submitting} type="submit"><Icon name="plus" size={17} /> Create affiliation</button>
				</Form>
			</section>

			<section className="organization-admin-list">
				{loaderData.affiliations.length === 0 ? <section className="panel empty-state"><strong>No affiliations yet</strong></section> : loaderData.affiliations.map((affiliation) => {
					const organizationLinks = loaderData.organizationLinks.filter((link) => link.affiliationId === affiliation.id);
					const directLinks = loaderData.userLinks.filter((link) => link.affiliationId === affiliation.id);
					const effectiveUserIds = [...new Set(loaderData.effectiveSources.filter((source) => source.affiliationId === affiliation.id).map((source) => source.userId))];
					return (
						<details className="panel organization-admin-card" key={affiliation.id}>
							<summary><span className="organization-monogram"><Icon name="people" size={20} /></span><div><strong>{affiliation.name}</strong><p>{affiliation.organizationCount} organizations · {affiliation.effectiveMemberCount} effective members</p></div><span className="status-pill status-pill--active">active</span><Icon name="chevron-right" size={18} /></summary>
							<div className="affiliation-admin-body">
								<Form className="affiliation-edit-form" method="post">
									<input name="intent" type="hidden" value="update" /><input name="affiliationId" type="hidden" value={affiliation.id} />
									<label>Name<input defaultValue={affiliation.name} name="name" required /></label>
									<label>URL slug<input defaultValue={affiliation.slug} name="slug" required /></label>
									<button className="button button--secondary" disabled={submitting} type="submit">Save affiliation</button>
								</Form>

								<div className="affiliation-manager-grid">
									<section>
										<div className="subsection-heading"><div><p className="eyebrow">Network membership</p><h3>Organizations</h3></div><span>{organizationLinks.length}</span></div>
										<Form className="affiliation-link-form" method="post"><input name="intent" type="hidden" value="add-organization" /><input name="affiliationId" type="hidden" value={affiliation.id} /><select aria-label="Organization" name="organizationId" required><option value="">Select an organization</option>{loaderData.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select><button className="button button--primary button--compact" type="submit">Add</button></Form>
										<div className="affiliation-link-list">{organizationLinks.length === 0 ? <p className="muted-empty">No organizations assigned.</p> : organizationLinks.map((link) => <article key={link.organizationId}><strong>{link.organizationName}</strong><Form method="post"><input name="intent" type="hidden" value="remove-organization" /><input name="affiliationId" type="hidden" value={affiliation.id} /><input name="organizationId" type="hidden" value={link.organizationId} /><button className="member-action-button member-action-button--suspend" type="submit">Remove</button></Form></article>)}</div>
									</section>

									<section>
										<div className="subsection-heading"><div><p className="eyebrow">Individual access</p><h3>Direct members</h3></div><span>{directLinks.length}</span></div>
										<Form className="affiliation-link-form" method="post"><input name="intent" type="hidden" value="add-user" /><input name="affiliationId" type="hidden" value={affiliation.id} /><select aria-label="Member" name="userId" required><option value="">Select an active member</option>{loaderData.members.map((member) => <option key={member.id} value={member.id}>{member.name ? `${member.name} — ${member.email}` : member.email}</option>)}</select><button className="button button--primary button--compact" type="submit">Add</button></Form>
										<div className="affiliation-link-list">{directLinks.length === 0 ? <p className="muted-empty">No direct assignments.</p> : directLinks.map((link) => <article key={link.userId}><div><strong>{link.userName || link.userEmail}</strong><p>{link.userEmail}</p></div><Form method="post"><input name="intent" type="hidden" value="remove-user" /><input name="affiliationId" type="hidden" value={affiliation.id} /><input name="userId" type="hidden" value={link.userId} /><button className="member-action-button member-action-button--suspend" type="submit">Remove</button></Form></article>)}</div>
									</section>
								</div>

								<div className="effective-affiliation-summary"><strong>Effective access</strong><p>{effectiveUserIds.length === 0 ? "No active members currently inherit or hold this affiliation." : `${effectiveUserIds.length} active members currently receive this affiliation directly or through an organization.`}</p></div>
							</div>
						</details>
					);
				})}
			</section>
		</div>
	);
}
