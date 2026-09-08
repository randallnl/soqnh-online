import { Form, Link, useActionData, useNavigation } from "react-router";

import type { Route } from "./+types/organization-detail";
import { Icon } from "~/components/icon";
import { IdentityAvatar, OrganizationIdentity } from "~/components/identity-avatar";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import {
	getOrganizationBySlug,
	OrganizationMutationError,
	requestDirectoryParticipation,
	withdrawDirectoryParticipation,
} from "~/models/organizations.server";

const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

function socialUrl(platform: string | null, handle: string) {
	if (/^https?:\/\//i.test(handle)) return handle;
	const account = handle.replace(/^@/, "").replace(/^\/+|\/+$/g, "");
	if (platform?.toLowerCase() === "instagram") return `https://www.instagram.com/${account}`;
	if (platform?.toLowerCase() === "facebook") return `https://www.facebook.com/${account}`;
	if (platform?.toLowerCase() === "tiktok") return `https://www.tiktok.com/@${account}`;
	return null;
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.organization.name ?? "Organization"} · State of Queer NH` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = await getOrganizationBySlug(context.cloudflare.env, params.slug, user);
	if (!result) {
		throw new Response("Organization not found", { status: 404 });
	}
	return {
		...result,
		canManage:
			user.siteRole === "site_admin" ||
			result.members.some((member) => member.userId === user.id && member.role === "org_admin"),
	};
}

export async function action({ request, context, params }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = await getOrganizationBySlug(context.cloudflare.env, params.slug, user);
	if (!result) throw new Response("Organization not found", { status: 404 });
	const formData = await request.formData();
	const optedIn = formData.get("directoryOptIn") === "on";
	try {
		if (optedIn) {
			await requestDirectoryParticipation(context.cloudflare.env, user, result.organization.id);
			return { ok: true as const, message: "Your State of Queer Digital opt-in request was submitted for review." };
		}
		await withdrawDirectoryParticipation(context.cloudflare.env, user, result.organization.id);
		return { ok: true as const, message: result.organization.directoryStatus === "pending" ? "The opt-in request was canceled." : "The organization opted out of State of Queer Digital." };
	} catch (error) {
		if (error instanceof OrganizationMutationError) {
			return {
				ok: false as const,
				error: error.reason === "forbidden"
					? "You no longer have permission to change this organization’s participation."
					: "The participation status changed before this request completed. Refresh and try again.",
			};
		}
		console.error(JSON.stringify({ message: "organization opt-in failed", actorUserId: user.id, organizationId: result.organization.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "The opt-in preference could not be saved." };
	}
}

export default function OrganizationDetail({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const { organization, members } = loaderData;
	const participating = organization.directoryStatus === "pending" || organization.directoryStatus === "published";
	const organizationSocialUrl = organization.socialHandle ? socialUrl(organization.socialPlatform, organization.socialHandle) : null;
	const sourceImageUrls = organization.sourceImageUrls?.split(/\n+/).map((url) => url.trim()).filter(Boolean) ?? [];
	return (
		<div className="organization-detail-page">
			<div className="organization-detail-actions">
				<Link className="back-link" to="/organizations">← All organizations</Link>
				{loaderData.canManage && <Link className="button button--secondary button--compact" to={`/organizations/${organization.slug}/manage`}><Icon name="settings" size={16} /> Manage organization</Link>}
			</div>
			<section className="organization-profile panel">
				<div className="organization-profile-header">
					<OrganizationIdentity large logoObjectKey={organization.logoObjectKey} name={organization.name} />
					<div>
						<p className="eyebrow">Ecosystem organization</p>
						<h1>{organization.name}</h1>
						<p>{organization.summary || "A member organization in the State of Queer NH ecosystem."}</p>
					</div>
				</div>
				{organization.description && <p className="organization-description">{organization.description}</p>}
				{(organization.category || organization.townCity || organization.region || organization.operatesStatewide !== null || organization.leadershipIdentity) && <dl className="organization-profile-facts">
					{organization.category && <div><dt>Category</dt><dd>{organization.category}</dd></div>}
					{organization.townCity && <div><dt>Town or city</dt><dd>{organization.townCity}</dd></div>}
					{organization.region && <div><dt>Region</dt><dd>{organization.region}</dd></div>}
					{organization.operatesStatewide !== null && <div><dt>Statewide services</dt><dd>{organization.operatesStatewide === 1 ? "Yes" : "No"}</dd></div>}
					{organization.leadershipIdentity && <div><dt>Queer and/or BIPOC-led</dt><dd>{organization.leadershipIdentity}</dd></div>}
				</dl>}
				{organization.listingRationale && <div className="organization-profile-note"><p className="eyebrow">Why this resource is included</p><p>{organization.listingRationale}</p></div>}
				{organization.affiliations.length > 0 && (
					<div className="organization-affiliations">
						<p className="eyebrow">Affiliations</p>
						<div className="affiliation-chip-row">{organization.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>
					</div>
				)}
				<div className="organization-contact-row">
					{organization.websiteUrl && <a href={organization.websiteUrl} rel="noreferrer" target="_blank"><Icon name="activity" size={16} /> Visit website</a>}
					{organization.eventSourceUrl && <a href={organization.eventSourceUrl} rel="noreferrer" target="_blank"><Icon name="calendar" size={16} /> View events</a>}
					{organization.contactEmail && <a href={`mailto:${organization.contactEmail}`}><Icon name="message" size={16} /> {organization.contactEmail}</a>}
					{organization.contactPhone && <a href={`tel:${organization.contactPhone.replace(/[^+\d]/g, "")}`}><Icon name="activity" size={16} /> {organization.contactPhone}</a>}
					{organization.socialHandle && (organizationSocialUrl ? <a href={organizationSocialUrl} rel="noreferrer" target="_blank"><Icon name="people" size={16} /> {organization.socialPlatform ? `${organization.socialPlatform}: ` : ""}{organization.socialHandle}</a> : <span><Icon name="people" size={16} /> {organization.socialPlatform ? `${organization.socialPlatform}: ` : ""}{organization.socialHandle}</span>)}
				</div>
				{sourceImageUrls.length > 0 && <div className="organization-source-images"><p className="eyebrow">Logo and photo sources</p><div>{sourceImageUrls.map((url, index) => <a href={url} key={`${index}-${url}`} rel="noreferrer" target="_blank">View source {index + 1}</a>)}</div></div>}
				{loaderData.canManage && (
					<Form className={`directory-profile-opt-in directory-profile-opt-in--${organization.directoryStatus}`} key={`${organization.directoryStatus}-${actionData ? (actionData.ok ? "success" : "error") : "idle"}`} method="post">
						<label>
							<input
								aria-describedby="directory-opt-in-description directory-opt-in-status"
								defaultChecked={participating}
								disabled={navigation.state === "submitting"}
								name="directoryOptIn"
								onChange={(event) => {
									if (!event.currentTarget.checked && !window.confirm("Opt this organization out of State of Queer Digital and remove it from the public directory?")) {
										event.currentTarget.checked = true;
										return;
									}
									event.currentTarget.form?.requestSubmit();
								}}
								type="checkbox"
							/>
							<span><strong>Opt in to State of Queer Digital</strong><small id="directory-opt-in-description">By checking this box, you confirm that this organization may be added to a public directory after administrator review. Its organization profile information may be published; member and affiliation details remain private.</small></span>
						</label>
						<p id="directory-opt-in-status">{organization.directoryStatus === "pending" ? "Pending administrator review. Uncheck the box to cancel this request." : organization.directoryStatus === "published" ? "Approved and eligible to appear in the public directory. Uncheck the box to opt out." : organization.directoryStatus === "rejected" ? `Changes requested${organization.directoryReviewNote ? `: ${organization.directoryReviewNote}` : "."}` : "Not currently opted in."}</p>
						{actionData && <p className={`form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}
					</Form>
				)}
			</section>

			<section className="panel organization-member-panel">
				<div className="panel-heading"><div><p className="eyebrow">People</p><h2>Organization members</h2></div><span>{members.length}</span></div>
				{members.length === 0 ? <div className="empty-state empty-state--compact"><strong>No active members listed</strong></div> : (
					<div className="organization-member-list">
						{members.map((member) => (
							<Link className="organization-member-link" key={member.userId} to={`/members/${member.userId}`}>
								<IdentityAvatar name={member.name || "Member"} objectKey={member.avatarObjectKey} />
								<div><strong>{member.name || "Member"}</strong><p>{roleLabels[member.role]}</p></div>
							</Link>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
