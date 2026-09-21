import { Form, Link, useActionData, useNavigation } from "react-router";

import type { Route } from "./+types/organization-detail";
import { Icon } from "~/components/icon";
import { IdentityAvatar, OrganizationIdentity } from "~/components/identity-avatar";
import { MentionText } from "~/components/mention-textarea";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";
import { formatEventDateTime } from "~/lib/events";
import { mediaUrl } from "~/lib/media";
import { organizationCategoryTone, parseOrganizationCategories } from "~/lib/organization-categories";
import { parseOrganizationLeadership } from "~/lib/organization-leadership";
import {
	getOrganizationBySlug,
	OrganizationMutationError,
	requestDirectoryParticipation,
	withdrawDirectoryParticipation,
} from "~/models/organizations.server";
import { listOrganizationProfileContent, type OrganizationProfilePost } from "~/models/posts.server";

const roleLabels = { viewer: "Viewer", contributor: "Contributor", org_admin: "Organization admin" } as const;

function leadershipIdentityTags(value: string | null) {
	return parseOrganizationLeadership(value)
		.filter((label) => !label.toLocaleLowerCase().startsWith("is this resource "))
		.map((label) => ({
			label,
			tone: label === "Queer-led" ? "plum" : label === "BIPOC-led" ? "gold" : label === "Not sure" ? "coral" : label === "Prefer not to say" ? "rose" : "blue",
		}));
}

function socialUrl(platform: string | null, handle: string) {
	if (/^https?:\/\//i.test(handle)) return handle;
	const account = handle.replace(/^@/, "").replace(/^\/+|\/+$/g, "");
	if (platform?.toLowerCase() === "instagram") return `https://www.instagram.com/${account}`;
	if (platform?.toLowerCase() === "facebook") return `https://www.facebook.com/${account}`;
	if (platform?.toLowerCase() === "tiktok") return `https://www.tiktok.com/@${account}`;
	return null;
}

function formatProfileDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function excerpt(value: string, length = 120) {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > length ? `${normalized.slice(0, length - 1).trimEnd()}…` : normalized;
}

const activitySections = [
	{ key: "events", title: "Upcoming events", icon: "calendar" as const, path: "events" },
	{ key: "projects", title: "Projects", icon: "clipboard" as const, path: "projects" },
	{ key: "updates", title: "Community updates", icon: "message" as const, path: "updates" },
] as const;

function OrganizationActivityCard({ post }: { post: OrganizationProfilePost }) {
	const thumbnailUrl = mediaUrl(post.thumbnailObjectKey) ?? post.thumbnailUrl;
	return <Link className="organization-activity-card" to={`/posts/${post.id}`}>
		{thumbnailUrl && <img alt="" loading="lazy" referrerPolicy={post.thumbnailObjectKey ? undefined : "no-referrer"} src={thumbnailUrl} />}
		<div>
			<span>{post.section === "event" && post.eventStartsAt ? formatEventDateTime(post.eventStartsAt) : formatProfileDate(post.createdAt)}</span>
			<h4>{post.section === "update" ? excerpt(post.body, 90) : post.title}</h4>
			{post.section === "event" && post.eventLocationName && <p>{post.eventLocationName}</p>}
			{post.section === "project" && <p>{excerpt(post.body, 90)}</p>}
			<small>{post.commentCount} {post.commentCount === 1 ? "comment" : "comments"} · {post.supportCount} {post.supportCount === 1 ? "support" : "supports"}</small>
		</div>
	</Link>;
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.organization.name ?? "Organization"} · NH Connect` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const result = await getOrganizationBySlug(context.cloudflare.env, params.slug, user);
	if (!result) {
		throw new Response("Organization not found", { status: 404 });
	}
	const content = await listOrganizationProfileContent(context.cloudflare.env, user, result.organization.id);
	return {
		...result,
		content,
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
			return { ok: true as const, message: "Your NH Connect public directory opt-in request was submitted for review." };
		}
		await withdrawDirectoryParticipation(context.cloudflare.env, user, result.organization.id);
		return { ok: true as const, message: result.organization.directoryStatus === "pending" ? "The opt-in request was canceled." : "The organization was removed from the NH Connect public directory." };
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
	const leadershipTags = leadershipIdentityTags(organization.leadershipIdentity);
	const directoryLabel = organization.directoryStatus === "published" ? "Public directory participant" : organization.directoryStatus === "pending" ? "Directory review pending" : "Member network profile";
	return (
		<div className="organization-detail-page">
			<div className="organization-detail-actions">
				<Link className="back-link" to="/organizations">← All organizations</Link>
				{loaderData.canManage && <Link className="button button--secondary button--compact" to={`/organizations/${organization.slug}/manage`}><Icon name="settings" size={16} /> Edit organization</Link>}
			</div>
			<section className="organization-profile panel">
				<div className="organization-profile-header">
					<OrganizationIdentity large logoObjectKey={organization.logoObjectKey} name={organization.name} />
					<div>
						<p className="eyebrow">Ecosystem organization</p>
						<h1>{organization.name}</h1>
						<p className="organization-profile-summary">{organization.summary || "A member organization in the NH Connect community network."}</p>
						<div className="organization-profile-badges"><span className={`organization-profile-badge organization-profile-badge--${organization.directoryStatus === "published" ? "green" : organization.directoryStatus === "pending" ? "gold" : "blue"}`}>{directoryLabel}</span>{organization.operatesStatewide === 1 && <span className="organization-profile-badge organization-profile-badge--plum">Statewide</span>}</div>
					</div>
				</div>
				{organization.profilePhotoObjectKey && <img alt={`${organization.name} profile`} className="organization-profile-photo" src={mediaUrl(organization.profilePhotoObjectKey) ?? undefined} />}
				{organization.description && <div className="organization-description"><MentionText targets={[]} text={organization.description} /></div>}
				<dl className="organization-profile-facts">
					{organization.category && <div><dt>Categories</dt><dd className="organization-category-row">{parseOrganizationCategories(organization.category).map((category) => <span className={`organization-category-chip organization-category-tone--${organizationCategoryTone(category)}`} key={category}>{category}</span>)}</dd></div>}
					{organization.townCity && <div><dt>Town or city</dt><dd>{organization.townCity}</dd></div>}
					{organization.region && <div><dt>Region</dt><dd>{organization.region}</dd></div>}
					{organization.operatesStatewide !== null && <div><dt>Statewide services</dt><dd>{organization.operatesStatewide === 1 ? "Yes" : "No"}</dd></div>}
					<div><dt>Organization members</dt><dd>{organization.memberCount} {organization.memberCount === 1 ? "member" : "members"} connected</dd></div>
					<div><dt>Profile updated</dt><dd>{formatProfileDate(organization.updatedAt)}</dd></div>
					{leadershipTags.length > 0 && <div><dt>Queer and/or BIPOC-led</dt><dd className="organization-category-row">{leadershipTags.map((tag) => <span className={`organization-category-chip organization-category-tone--${tag.tone}`} key={tag.label}>{tag.label}</span>)}</dd></div>}
				</dl>
				{organization.listingRationale && <div className="organization-profile-note"><p className="eyebrow">Why this resource is included</p><MentionText targets={[]} text={organization.listingRationale} /></div>}
				{organization.affiliations.length > 0 && (
					<div className="organization-affiliations">
						<p className="eyebrow">Affiliations</p>
						<div className="affiliation-chip-row">{organization.affiliations.map((affiliation) => <span key={affiliation.id}>{affiliation.name}</span>)}</div>
					</div>
				)}
				{(organization.websiteUrl || organization.eventSourceUrl || organization.contactEmail || organization.contactPhone || organization.socialHandle) && <div className="organization-connect-section"><p className="eyebrow">Connect</p><div className="organization-contact-row">
					{organization.websiteUrl && <a href={organization.websiteUrl} rel="noreferrer" target="_blank"><Icon name="activity" size={16} /> Visit website</a>}
					{organization.eventSourceUrl && <a href={organization.eventSourceUrl} rel="noreferrer" target="_blank"><Icon name="calendar" size={16} /> View events</a>}
					{organization.contactEmail && <a href={`mailto:${organization.contactEmail}`}><Icon name="message" size={16} /> {organization.contactEmail}</a>}
					{organization.contactPhone && <a href={`tel:${organization.contactPhone.replace(/[^+\d]/g, "")}`}><Icon name="activity" size={16} /> {organization.contactPhone}</a>}
					{organization.socialHandle && (organizationSocialUrl ? <a href={organizationSocialUrl} rel="noreferrer" target="_blank"><Icon name="people" size={16} /> {organization.socialPlatform ? `${organization.socialPlatform}: ` : ""}{organization.socialHandle}</a> : <span><Icon name="people" size={16} /> {organization.socialPlatform ? `${organization.socialPlatform}: ` : ""}{organization.socialHandle}</span>)}
				</div></div>}
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
									if (!event.currentTarget.checked && !window.confirm("Remove this organization from the NH Connect public directory?")) {
										event.currentTarget.checked = true;
										return;
									}
									event.currentTarget.form?.requestSubmit();
								}}
								type="checkbox"
							/>
							<span><strong>Opt in to the NH Connect public directory</strong><small id="directory-opt-in-description">All signed-in members can already view this organization profile. By checking this box, you confirm that its profile information may also be made public after administrator review; member and affiliation details remain private.</small></span>
						</label>
						<p id="directory-opt-in-status">{organization.directoryStatus === "pending" ? "Pending administrator review. Uncheck the box to cancel this request." : organization.directoryStatus === "published" ? "Approved and eligible to appear in the public directory. Uncheck the box to opt out." : organization.directoryStatus === "rejected" ? `Changes requested${organization.directoryReviewNote ? `: ${organization.directoryReviewNote}` : "."}` : "Not currently opted in."}</p>
						{actionData && <p className={`form-message form-message--${actionData.ok ? "success" : "error"}`}>{actionData.ok ? actionData.message : actionData.error}</p>}
					</Form>
				)}
			</section>

			<section className="panel organization-activity-panel">
				<div className="panel-heading"><div><p className="eyebrow">From this organization</p><h2>Events, projects, and updates</h2></div></div>
				<div className="organization-activity-grid">{activitySections.map((section) => {
					const posts = loaderData.content[section.key];
					const total = loaderData.content.totals[section.key];
					return <section className={`organization-activity-group organization-activity-group--${section.key}`} key={section.key}>
						<header><span><Icon name={section.icon} size={17} /></span><div><h3>{section.title}</h3><p>{total} visible to you</p></div><Link to={`/${section.path}?organization=${encodeURIComponent(organization.id)}`}>View all</Link></header>
						{posts.length > 0 ? <div>{posts.map((post) => <OrganizationActivityCard key={post.id} post={post} />)}</div> : <p className="organization-activity-empty">Nothing to show yet.</p>}
					</section>;
				})}</div>
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
