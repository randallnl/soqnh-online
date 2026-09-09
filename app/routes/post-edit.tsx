import { redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/post-edit";
import { PostEditor } from "~/components/post-editor";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { communityUpdateTitle, normalizeTags, postStatuses, postVisibilities, routeSectionForDatabase } from "~/lib/content";
import { requireSameOrigin } from "~/lib/http.server";
import { parseEventDetails } from "~/lib/events";
import { deleteContentImage, ImageUploadError, requireUploadRequestSize, uploadContentImage } from "~/lib/media.server";
import type { ContentImageAttachment } from "~/lib/media";
import { getPostById, listAvailablePostAffiliations, listPostOrganizations, PostMutationError, updatePost } from "~/models/posts.server";
import { listVisibleMembers } from "~/models/profiles.server";
import { listVisibleOrganizations } from "~/models/organizations.server";
import { listPostMentionUserIds, syncPostMentions } from "~/models/interactions.server";
import type { MentionTarget } from "~/components/mention-textarea";

const optionalOrganization = z.preprocess((value) => typeof value === "string" && value.trim() ? value.trim() : null, z.string().max(100).nullable());
const formSchema = z.object({
	postId: z.string().uuid(),
	title: z.string().trim().min(3, "Enter a title").max(180),
	body: z.string().trim().min(2, "Add a little more detail").max(12000),
	organizationId: optionalOrganization,
	visibility: z.enum(postVisibilities),
	status: z.enum(postStatuses),
	tags: z.string().max(320),
});

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const post = await getPostById(context.cloudflare.env, user, params.postId);
	if (!post) throw new Response("Post not found", { status: 404 });
	if (!post.canEdit) throw new Response("Forbidden", { status: 403 });
	const [organizations, affiliations, members, visibleOrganizations, mentionUserIds] = await Promise.all([
		listPostOrganizations(context.cloudflare.env, user),
		listAvailablePostAffiliations(context.cloudflare.env, user),
		listVisibleMembers(context.cloudflare.env, user),
		listVisibleOrganizations(context.cloudflare.env, user),
		listPostMentionUserIds(context.cloudflare.env, user, post.id),
	]);
	const mentionTargets: MentionTarget[] = [
		...members.filter((member) => member.id !== user.id).map((member) => ({ id: member.id, type: "person" as const, label: member.name || "Member", detail: member.profileTitle || member.organizationNames, href: `/members/${member.id}` })),
		...visibleOrganizations.map((organization) => ({ id: organization.id, type: "organization" as const, label: organization.name, detail: organization.summary, href: `/organizations/${organization.slug}` })),
	];
	return { post, section: routeSectionForDatabase(post.section), organizations, affiliations, mentionTargets, mentionUserIds };
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
	const requestedAffiliationIds = [...new Set(formData.getAll("affiliationId").filter((value): value is string => typeof value === "string" && value.length > 0))];
	const mentionUserIds = [...new Set(formData.getAll("mentionUserId").filter((value): value is string => typeof value === "string" && value.length > 0))];
	const result = formSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the post details" };
	let uploadedImage: ContentImageAttachment | null = null;
	let attachmentPersisted = false;
	try {
		const existing = await getPostById(context.cloudflare.env, user, result.data.postId);
		if (!existing) throw new PostMutationError("not-found");
		const affiliationIds = formData.get("ecosystemWide") === "true" ? [] : requestedAffiliationIds;
		if (existing.section !== "update" && result.data.body.length < 10) return { ok: false as const, error: "Add a little more detail" };
		const eventResult = existing.section === "event" ? parseEventDetails(formData) : null;
		if (eventResult && !eventResult.success) return { ok: false as const, error: eventResult.error.issues[0]?.message ?? "Check the event details" };
		if (existing.section === "project" || existing.section === "update") uploadedImage = await uploadContentImage(context.cloudflare.env, formData.get("image"), user.id);
		await updatePost(context.cloudflare.env, user, { ...result.data, title: existing.section === "update" ? communityUpdateTitle(result.data.body) : result.data.title, tags: normalizeTags(result.data.tags), affiliationIds, event: eventResult?.data, attachment: uploadedImage });
		attachmentPersisted = true;
		if (existing.section === "update") await syncPostMentions(context.cloudflare.env, user, result.data.postId, mentionUserIds, existing.status !== "published" && result.data.status === "published");
		throw redirect(`/posts/${result.data.postId}`);
	} catch (error) {
		if (error instanceof Response) throw error;
		if (uploadedImage && !attachmentPersisted) await deleteContentImage(context.cloudflare.env, uploadedImage.objectKey).catch((cleanupError) => console.error(JSON.stringify({ message: "orphaned post image cleanup failed", objectKey: uploadedImage?.objectKey, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) })));
		if (error instanceof ImageUploadError) return { ok: false as const, error: error.reason === "too-large" ? "Upload an image smaller than 2 MB." : error.reason === "unsupported" ? "Upload a PNG, JPG, WebP, or GIF image." : "The uploaded file does not appear to be a valid image." };
		if (error instanceof PostMutationError) {
			const messages = { "not-found": "That post is no longer available.", "forbidden": "You cannot edit that post.", "organization-required": "Choose an organization for that visibility setting.", "organization-unavailable": "You cannot post for that organization.", "affiliation-required": "Choose at least one affiliation, or opt the posting organization in to State of Queer Digital for statewide sharing.", "affiliation-unavailable": "You can only tag affiliations you belong to.", "event-details-required": "Add the event date and time before submitting it." };
			return { ok: false as const, error: messages[error.reason] };
		}
		return { ok: false as const, error: "The post could not be updated." };
	}
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `Edit ${data?.post.title ?? "post"} · State of Queer NH` }];
}

export default function PostEdit({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	return <div className="post-editor-page"><section className="page-heading"><div><p className="eyebrow">Content management</p><h1>Edit {loaderData.section === "events" ? "event" : "post"}</h1><p>{loaderData.section === "events" ? "Any saved event changes return it to the moderation queue." : "Update the content, audience, organization, tags, or publication state."}</p></div></section><PostEditor affiliations={loaderData.affiliations} mentionTargets={loaderData.mentionTargets} mentionUserIds={loaderData.mentionUserIds} message={actionData ? { ok: actionData.ok, text: actionData.ok ? "" : actionData.error } : undefined} organizations={loaderData.organizations} post={loaderData.post} section={loaderData.section} submitting={navigation.state === "submitting"} /></div>;
}
