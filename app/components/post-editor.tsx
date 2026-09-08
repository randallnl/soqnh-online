import { Form, Link } from "react-router";
import { useState } from "react";

import { postStatuses, postVisibilities, type ContentSection } from "~/lib/content";
import { eventDateTimeInputValue } from "~/lib/events";
import type { PostAffiliationOption, PostOrganizationOption, PostRecord } from "~/models/posts.server";

const visibilityLabels = { members: "Shared network or affiliations", organization: "Organization members only" } as const;
const statusLabels = { draft: "Save as draft", published: "Publish now" } as const;

export function PostEditor({
	section,
	organizations,
	affiliations,
	allowEcosystemWide,
	post,
	submitting,
	message,
}: {
	section: ContentSection;
	organizations: PostOrganizationOption[];
	affiliations: PostAffiliationOption[];
	allowEcosystemWide: boolean;
	post?: PostRecord;
	submitting: boolean;
	message?: { ok: boolean; text: string };
}) {
	const isEvent = section === "events";
	const [visibility, setVisibility] = useState(post?.visibility ?? "members");
	return (
		<Form className="panel post-editor-form" method="post">
			<input name="section" type="hidden" value={section} />
			{post && <input name="postId" type="hidden" value={post.id} />}
			<div className="post-editor-grid">
				<label className="wide-field">Title<input defaultValue={post?.title ?? ""} maxLength={180} name="title" required /></label>
				<label className="wide-field">Body<textarea defaultValue={post?.body ?? ""} maxLength={12000} name="body" required rows={12} /></label>
				{isEvent && <fieldset className="event-editor-fields wide-field"><legend>Event details</legend><div className="post-editor-grid"><label>Starts<input defaultValue={eventDateTimeInputValue(post?.eventStartsAt ?? null)} name="startsAt" required type="datetime-local" /></label><label>Ends <span>(optional)</span><input defaultValue={eventDateTimeInputValue(post?.eventEndsAt ?? null)} name="endsAt" type="datetime-local" /></label><label className="wide-field">Location<input defaultValue={post?.eventLocationName ?? ""} maxLength={240} name="locationName" placeholder="Venue, town, or Online" /></label><label>Map or location URL<input defaultValue={post?.eventLocationUrl ?? ""} name="locationUrl" placeholder="https://…" type="url" /></label><label>Registration URL<input defaultValue={post?.eventRegistrationUrl ?? ""} name="registrationUrl" placeholder="https://…" type="url" /></label><label>Original source URL<input defaultValue={post?.eventSourceUrl ?? ""} name="sourceUrl" placeholder="https://…" type="url" /></label><label>Image URL<input defaultValue={post?.eventImageUrl ?? ""} name="imageUrl" placeholder="https://…" type="url" /></label></div></fieldset>}
				<label>Organization<select defaultValue={post?.organizationId ?? (allowEcosystemWide ? "" : organizations[0]?.id ?? "")} name="organizationId">{allowEcosystemWide && <option value="">Ecosystem-wide</option>}{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}{organization.directoryStatus === "published" ? " · State of Queer Digital" : ""}</option>)}</select></label>
				<label>Visibility<select name="visibility" onChange={(event) => setVisibility(event.currentTarget.value as typeof visibility)} value={visibility}>{postVisibilities.map((option) => <option key={option} value={option}>{visibilityLabels[option]}</option>)}</select></label>
				{isEvent ? <input name="status" type="hidden" value="draft" /> : <label>Publication<select defaultValue={post?.status === "archived" ? "draft" : post?.status ?? "published"} name="status">{postStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>}
				<label>Tags<input defaultValue={post?.tags.join(", ") ?? ""} maxLength={320} name="tags" placeholder="policy, mutual-aid, seacoast" /></label>
				<fieldset className="post-affiliation-picker wide-field" disabled={visibility === "organization"}>
					<legend>Affiliation audience {visibility === "members" && <span>(optional for participating organizations)</span>}</legend>
					<p>{visibility === "members" ? "Leave every affiliation unchecked to share with the statewide State of Queer Digital network. Select affiliations to limit the post to those coalition spaces. Organizations that have not opted in must select at least one affiliation." : "Organization-only content is not shared through affiliations."}</p>
					{affiliations.length > 0 ? <div>{affiliations.map((affiliation) => <label key={affiliation.id}><input defaultChecked={post?.affiliations.some((selected) => selected.id === affiliation.id)} name="affiliationId" type="checkbox" value={affiliation.id} />{affiliation.name}</label>)}</div> : <p className="post-affiliation-empty">You do not currently have an affiliation available for shared-network content.</p>}
				</fieldset>
			</div>
			<p className="field-help">{isEvent ? "Events are submitted for moderator approval. Saving changes to an approved event returns it to the queue. " : ""}Use up to eight comma-separated topic tags. An untagged shared-network post reaches participating organizations statewide; affiliation tags create a narrower audience. Organization-only posts require direct membership.</p>
			{isEvent && post?.eventModerationStatus === "rejected" && <p className="form-message form-message--error"><strong>Changes requested.</strong>{post.eventRejectionReason ? ` ${post.eventRejectionReason}` : " Review the event details and resubmit."}</p>}
			{message && <p className={`form-message form-message--${message.ok ? "success" : "error"}`}>{message.text}</p>}
			<div className="post-editor-actions"><button className="button button--primary" disabled={submitting} type="submit">{submitting ? "Saving…" : isEvent ? post ? "Save and resubmit" : "Submit event" : post ? "Save changes" : "Create post"}</button><Link className="button button--secondary" to={post ? `/posts/${post.id}` : `/${section}`}>Cancel</Link></div>
		</Form>
	);
}
