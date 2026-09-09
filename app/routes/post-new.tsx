import { redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/post-new";
import { PostEditor } from "~/components/post-editor";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { communityUpdateTitle, contentSections, isContentSection, normalizeTags, postStatuses, postVisibilities, sectionDefinitions } from "~/lib/content";
import { requireSameOrigin } from "~/lib/http.server";
import { parseEventDetails } from "~/lib/events";
import { deleteContentImage, ImageUploadError, requireUploadRequestSize, uploadContentImage } from "~/lib/media.server";
import type { ContentImageAttachment } from "~/lib/media";
import { createPost, listAvailablePostAffiliations, listPostOrganizations, PostMutationError } from "~/models/posts.server";
import { listVisibleMembers } from "~/models/profiles.server";
import { listVisibleOrganizations } from "~/models/organizations.server";
import { syncPostMentions } from "~/models/interactions.server";
import type { MentionTarget } from "~/components/mention-textarea";

const optionalOrganization = z.preprocess((value) => typeof value === "string" && value.trim() ? value.trim() : null, z.string().max(100).nullable());
const formSchema = z.object({
	section: z.enum(contentSections),
	title: z.string().trim().min(3, "Enter a title").max(180),
	body: z.string().trim().min(2, "Add a little more detail").max(12000),
	organizationId: optionalOrganization,
	visibility: z.enum(postVisibilities),
	status: z.enum(postStatuses),
	tags: z.string().max(320),
});

function messageFor(error: PostMutationError) {
	return {
		"not-found": "That post is no longer available.",
		"forbidden": "You do not have permission to create this post.",
		"organization-required": "Choose an organization for this post and visibility setting.",
		"organization-unavailable": "You need a contributor or organization-admin role to post for that organization.",
		"affiliation-required": "Choose at least one affiliation, or opt the posting organization in to State of Queer Digital for statewide sharing.",
		"affiliation-unavailable": "You can only tag affiliations you belong to.",
		"event-details-required": "Add the event date and time before submitting it.",
	}[error.reason];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const requestedSection = new URL(request.url).searchParams.get("section") ?? undefined;
	const section = isContentSection(requestedSection) ? requestedSection : "updates";
	const [organizations, affiliations, members, visibleOrganizations] = await Promise.all([
		listPostOrganizations(context.cloudflare.env, user),
		listAvailablePostAffiliations(context.cloudflare.env, user),
		listVisibleMembers(context.cloudflare.env, user),
		listVisibleOrganizations(context.cloudflare.env, user),
	]);
	const mentionTargets: MentionTarget[] = [
		...members.filter((member) => member.id !== user.id).map((member) => ({ id: member.id, type: "person" as const, label: member.name || "Member", detail: member.profileTitle || member.organizationNames, href: `/members/${member.id}` })),
		...visibleOrganizations.map((organization) => ({ id: organization.id, type: "organization" as const, label: organization.name, detail: organization.summary, href: `/organizations/${organization.slug}` })),
	];
	return { section, definition: sectionDefinitions[section], organizations, affiliations, mentionTargets };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	try {
		requireUploadRequestSize(request);
	} catch (error) {
		if (error instanceof ImageUploadError) return { ok: false as const, error: "Upload an image smaller than 10 MB." };
		throw error;
	}
	const formData = await request.formData();
	const requestedAffiliationIds = [...new Set(formData.getAll("affiliationId").filter((value): value is string => typeof value === "string" && value.length > 0))];
	const mentionUserIds = [...new Set(formData.getAll("mentionUserId").filter((value): value is string => typeof value === "string" && value.length > 0))];
	const result = formSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the post details" };
	const affiliationIds = formData.get("ecosystemWide") === "true" ? [] : requestedAffiliationIds;
	if (result.data.section !== "updates" && result.data.body.length < 10) return { ok: false as const, error: "Add a little more detail" };
	const eventResult = result.data.section === "events" ? parseEventDetails(formData) : null;
	if (eventResult && !eventResult.success) return { ok: false as const, error: eventResult.error.issues[0]?.message ?? "Check the event details" };
	let uploadedImage: ContentImageAttachment | null = null;
	let attachmentPersisted = false;
	try {
		if (result.data.section === "projects" || result.data.section === "updates") {
			uploadedImage = await uploadContentImage(context.cloudflare.env, formData.get("image"), user.id);
		}
		const created = await createPost(context.cloudflare.env, user, {
			...result.data,
			title: result.data.section === "updates" ? communityUpdateTitle(result.data.body) : result.data.title,
			section: sectionDefinitions[result.data.section].databaseValue,
			tags: normalizeTags(result.data.tags),
			affiliationIds,
			event: eventResult?.data,
			attachment: uploadedImage,
		});
		attachmentPersisted = true;
		if (result.data.section === "updates") await syncPostMentions(context.cloudflare.env, user, created.id, mentionUserIds);
		throw redirect(`/posts/${created.id}`);
	} catch (error) {
		if (error instanceof Response) throw error;
		if (uploadedImage && !attachmentPersisted) await deleteContentImage(context.cloudflare.env, uploadedImage.objectKey).catch((cleanupError) => console.error(JSON.stringify({ message: "orphaned post image cleanup failed", objectKey: uploadedImage?.objectKey, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) })));
		if (error instanceof ImageUploadError) return { ok: false as const, error: error.reason === "too-large" ? "Upload an image smaller than 10 MB." : error.reason === "unsupported" ? "Upload a PNG, JPG, WebP, or GIF image." : "The uploaded file does not appear to be a valid image." };
		if (error instanceof PostMutationError) return { ok: false as const, error: messageFor(error) };
		console.error(JSON.stringify({ message: "post creation failed", actorUserId: user.id, error: error instanceof Error ? error.message : String(error) }));
		return { ok: false as const, error: "The post could not be created." };
	}
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `New ${data?.definition.title ?? "post"} · State of Queer NH` }];
}

export default function PostNew({ loaderData }: Route.ComponentProps) {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	return <div className="post-editor-page"><section className="page-heading"><div><p className="eyebrow">{loaderData.definition.eyebrow}</p><h1>{loaderData.definition.action}</h1><p>{loaderData.section === "events" ? "Submit an event with the details moderators need to review and publish it." : "Create a focused post for the people and organizations who should see it."}</p></div></section><PostEditor affiliations={loaderData.affiliations} mentionTargets={loaderData.mentionTargets} message={actionData ? { ok: actionData.ok, text: actionData.ok ? "" : actionData.error } : undefined} organizations={loaderData.organizations} section={loaderData.section} submitting={navigation.state === "submitting"} /></div>;
}
