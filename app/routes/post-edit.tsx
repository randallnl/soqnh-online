import { redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/post-edit";
import { PostEditor } from "~/components/post-editor";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { normalizeTags, postStatuses, postVisibilities, routeSectionForDatabase } from "~/lib/content";
import { requireSameOrigin } from "~/lib/http.server";
import { parseEventDetails } from "~/lib/events";
import { getPostById, listPostOrganizations, PostMutationError, updatePost } from "~/models/posts.server";

const optionalOrganization = z.preprocess((value) => typeof value === "string" && value.trim() ? value.trim() : null, z.string().max(100).nullable());
const formSchema = z.object({
	postId: z.string().uuid(),
	title: z.string().trim().min(3, "Enter a title").max(180),
	body: z.string().trim().min(10, "Add a little more detail").max(12000),
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
	const organizations = await listPostOrganizations(context.cloudflare.env, user);
	return { post, section: routeSectionForDatabase(post.section), organizations, allowEcosystemWide: user.siteRole === "site_admin" };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const formData = await request.formData();
	const result = formSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the post details" };
	try {
		const existing = await getPostById(context.cloudflare.env, user, result.data.postId);
		if (!existing) throw new PostMutationError("not-found");
		const eventResult = existing.section === "event" ? parseEventDetails(formData) : null;
		if (eventResult && !eventResult.success) return { ok: false as const, error: eventResult.error.issues[0]?.message ?? "Check the event details" };
		await updatePost(context.cloudflare.env, user, { ...result.data, tags: normalizeTags(result.data.tags), event: eventResult?.data });
		throw redirect(`/posts/${result.data.postId}`);
	} catch (error) {
		if (error instanceof Response) throw error;
		if (error instanceof PostMutationError) {
			const messages = { "not-found": "That post is no longer available.", "forbidden": "You cannot edit that post.", "organization-required": "Choose an organization for that visibility setting.", "organization-unavailable": "You cannot post for that organization.", "event-details-required": "Add the event date and time before submitting it." };
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
	return <div className="post-editor-page"><section className="page-heading"><div><p className="eyebrow">Content management</p><h1>Edit {loaderData.section === "events" ? "event" : "post"}</h1><p>{loaderData.section === "events" ? "Any saved event changes return it to the moderation queue." : "Update the content, audience, organization, tags, or publication state."}</p></div></section><PostEditor allowEcosystemWide={loaderData.allowEcosystemWide} message={actionData ? { ok: actionData.ok, text: actionData.ok ? "" : actionData.error } : undefined} organizations={loaderData.organizations} post={loaderData.post} section={loaderData.section} submitting={navigation.state === "submitting"} /></div>;
}
