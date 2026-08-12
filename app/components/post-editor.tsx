import { Form, Link } from "react-router";

import { postStatuses, postVisibilities, type ContentSection } from "~/lib/content";
import type { PostOrganizationOption, PostRecord } from "~/models/posts.server";

const visibilityLabels = { members: "Shared network", organization: "Organization members only" } as const;
const statusLabels = { draft: "Save as draft", published: "Publish now" } as const;

export function PostEditor({
	section,
	organizations,
	allowEcosystemWide,
	post,
	submitting,
	message,
}: {
	section: ContentSection;
	organizations: PostOrganizationOption[];
	allowEcosystemWide: boolean;
	post?: PostRecord;
	submitting: boolean;
	message?: { ok: boolean; text: string };
}) {
	return (
		<Form className="panel post-editor-form" method="post">
			<input name="section" type="hidden" value={section} />
			{post && <input name="postId" type="hidden" value={post.id} />}
			<div className="post-editor-grid">
				<label className="wide-field">Title<input defaultValue={post?.title ?? ""} maxLength={180} name="title" required /></label>
				<label className="wide-field">Body<textarea defaultValue={post?.body ?? ""} maxLength={12000} name="body" required rows={12} /></label>
				<label>Organization<select defaultValue={post?.organizationId ?? (allowEcosystemWide ? "" : organizations[0]?.id ?? "")} name="organizationId">{allowEcosystemWide && <option value="">Ecosystem-wide</option>}{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
				<label>Visibility<select defaultValue={post?.visibility ?? "members"} name="visibility">{postVisibilities.map((visibility) => <option key={visibility} value={visibility}>{visibilityLabels[visibility]}</option>)}</select></label>
				<label>Publication<select defaultValue={post?.status === "archived" ? "draft" : post?.status ?? "published"} name="status">{postStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
				<label>Tags<input defaultValue={post?.tags.join(", ") ?? ""} maxLength={320} name="tags" placeholder="policy, mutual-aid, seacoast" /></label>
			</div>
			<p className="field-help">Use up to eight comma-separated tags. Shared-network posts follow affiliation visibility; organization-only posts require direct membership.</p>
			{message && <p className={`form-message form-message--${message.ok ? "success" : "error"}`}>{message.text}</p>}
			<div className="post-editor-actions"><button className="button button--primary" disabled={submitting} type="submit">{submitting ? "Saving…" : post ? "Save changes" : "Create post"}</button><Link className="button button--secondary" to={post ? `/posts/${post.id}` : `/${section}`}>Cancel</Link></div>
		</Form>
	);
}
