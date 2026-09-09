import { Form, Link } from "react-router";
import { useState } from "react";

import { AffiliationAudiencePicker } from "~/components/affiliation-audience-picker";
import { postStatuses, postVisibilities, type ContentSection } from "~/lib/content";
import { eventDateTimeInputValue } from "~/lib/events";
import { imageUploadAccept, mediaUrl } from "~/lib/media";
import { MentionTextarea, type MentionTarget } from "~/components/mention-textarea";
import type { PostAffiliationOption, PostOrganizationOption, PostRecord } from "~/models/posts.server";

const visibilityLabels = { members: "Ecosystem-wide or affiliations", organization: "Organization members only" } as const;
const statusLabels = { draft: "Save as draft", published: "Publish now" } as const;

export function PostEditor({
	section,
	organizations,
	affiliations,
	post,
	submitting,
	message,
	mentionTargets = [],
	mentionUserIds = [],
}: {
	section: ContentSection;
	organizations: PostOrganizationOption[];
	affiliations: PostAffiliationOption[];
	post?: PostRecord;
	submitting: boolean;
	message?: { ok: boolean; text: string };
	mentionTargets?: MentionTarget[];
	mentionUserIds?: string[];
}) {
	const isEvent = section === "events";
	const isUpdate = section === "updates";
	const [visibility, setVisibility] = useState(isUpdate || isEvent ? "members" : post?.visibility ?? "members");
	return (
		<Form className="panel post-editor-form" encType="multipart/form-data" method="post">
			<input name="section" type="hidden" value={section} />
			{post && <input name="postId" type="hidden" value={post.id} />}
			<div className="post-editor-grid">
				{isUpdate ? <input name="title" type="hidden" value={post?.title ?? "Community update"} /> : <label className="wide-field">Title<input defaultValue={post?.title ?? ""} maxLength={180} name="title" required /></label>}
				<label className="wide-field">{isUpdate ? "Community update" : "Body"}{isUpdate ? <><MentionTextarea defaultMentionUserIds={mentionUserIds} defaultValue={post?.body ?? ""} id="post-body" maxLength={12000} required rows={8} targets={mentionTargets} /><span className="field-help">Type @ to tag a person or organization. Tagged people receive a notification when the update is published.</span></> : <textarea defaultValue={post?.body ?? ""} maxLength={12000} name="body" required rows={12} />}</label>
				{isEvent && <fieldset className="event-editor-fields wide-field"><legend>Event details</legend><div className="post-editor-grid"><label>Starts<input defaultValue={eventDateTimeInputValue(post?.eventStartsAt ?? null)} name="startsAt" required type="datetime-local" /></label><label>Ends <span>(optional)</span><input defaultValue={eventDateTimeInputValue(post?.eventEndsAt ?? null)} name="endsAt" type="datetime-local" /></label><label className="wide-field">Location<input defaultValue={post?.eventLocationName ?? ""} maxLength={240} name="locationName" placeholder="Venue, town, or Online" /></label><label>Map or location URL<input defaultValue={post?.eventLocationUrl ?? ""} name="locationUrl" placeholder="https://…" type="url" /></label><label>Registration URL<input defaultValue={post?.eventRegistrationUrl ?? ""} name="registrationUrl" placeholder="https://…" type="url" /></label><label>Original source URL<input defaultValue={post?.eventSourceUrl ?? ""} name="sourceUrl" placeholder="https://…" type="url" /></label><label>Image URL<input defaultValue={post?.eventImageUrl ?? ""} name="imageUrl" placeholder="https://…" type="url" /></label></div></fieldset>}
				{(isUpdate || section === "projects") && <label className="wide-field">Image <span>(optional)</span><input accept={imageUploadAccept} name="image" type="file" /><span className="field-help">PNG, JPG, WebP, or GIF. Maximum 2 MB.</span></label>}
				{post && post.imageAttachments.length > 0 && <div className="content-image-gallery wide-field">{post.imageAttachments.map((image) => <img alt={image.filename} key={image.id} src={mediaUrl(image.objectKey) ?? undefined} />)}</div>}
				<label>Post as<select defaultValue={post?.organizationId ?? organizations[0]?.id ?? ""} name="organizationId"><option value="">Yourself</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}{organization.directoryStatus === "published" ? " · State of Queer Digital" : ""}</option>)}</select></label>
				{isUpdate || isEvent ? <input name="visibility" type="hidden" value="members" /> : <label>Visibility<select name="visibility" onChange={(event) => setVisibility(event.currentTarget.value as typeof visibility)} value={visibility}>{postVisibilities.map((option) => <option key={option} value={option}>{visibilityLabels[option]}</option>)}</select></label>}
				{isEvent ? <input name="status" type="hidden" value="draft" /> : isUpdate ? <input name="status" type="hidden" value="published" /> : <label>Publication<select defaultValue={post?.status === "archived" ? "draft" : post?.status ?? "published"} name="status">{postStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>}
				<label>Tags<input defaultValue={post?.tags.join(", ") ?? ""} maxLength={320} name="tags" placeholder="policy, mutual-aid, seacoast" /></label>
				<fieldset className="post-affiliation-picker wide-field" disabled={visibility === "organization"}>
					<legend>{isEvent ? "Event audience" : "Audience"}</legend>
					<p>{visibility === "members" ? "Choose Ecosystem-wide to share with every signed-in member, or select affiliations to limit this post to those coalition spaces." : "Organization-only content is not shared through affiliations."}</p>
					<AffiliationAudiencePicker affiliations={affiliations} defaultSelectedIds={post?.affiliations.map((affiliation) => affiliation.id)} />
				</fieldset>
			</div>
			<p className="field-help">{isEvent ? "Events are submitted for moderator approval. Saving changes to an approved event returns it to the queue. Ecosystem-wide events reach every signed-in member; affiliation selections create a narrower audience. " : ""}Use up to eight comma-separated topic tags.{!isEvent && " Ecosystem-wide posts reach every signed-in member; affiliation selections create a narrower audience. Organization-only posts require direct membership."}</p>
			{isEvent && post?.eventModerationStatus === "rejected" && <p className="form-message form-message--error"><strong>Changes requested.</strong>{post.eventRejectionReason ? ` ${post.eventRejectionReason}` : " Review the event details and resubmit."}</p>}
			{message && <p className={`form-message form-message--${message.ok ? "success" : "error"}`}>{message.text}</p>}
			<div className="post-editor-actions"><button className="button button--primary" disabled={submitting} type="submit">{submitting ? "Saving…" : isEvent ? post ? "Save and resubmit" : "Submit event" : isUpdate ? post ? "Save update" : "Post update" : post ? "Save changes" : "Create post"}</button><Link className="button button--secondary" to={post ? `/posts/${post.id}` : `/${section}`}>Cancel</Link></div>
		</Form>
	);
}
