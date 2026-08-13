import { redirect, useActionData, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/post-new";
import { PostEditor } from "~/components/post-editor";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { contentSections, isContentSection, normalizeTags, postStatuses, postVisibilities, sectionDefinitions } from "~/lib/content";
import { requireSameOrigin } from "~/lib/http.server";
import { parseEventDetails } from "~/lib/events";
import { createPost, listPostOrganizations, PostMutationError } from "~/models/posts.server";

const optionalOrganization = z.preprocess((value) => typeof value === "string" && value.trim() ? value.trim() : null, z.string().max(100).nullable());
const formSchema = z.object({
	section: z.enum(contentSections),
	title: z.string().trim().min(3, "Enter a title").max(180),
	body: z.string().trim().min(10, "Add a little more detail").max(12000),
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
		"event-details-required": "Add the event date and time before submitting it.",
	}[error.reason];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const requestedSection = new URL(request.url).searchParams.get("section") ?? undefined;
	const section = isContentSection(requestedSection) ? requestedSection : "updates";
	const organizations = await listPostOrganizations(context.cloudflare.env, user);
	if (user.siteRole !== "site_admin" && organizations.length === 0) throw new Response("Forbidden", { status: 403 });
	return { section, definition: sectionDefinitions[section], organizations, allowEcosystemWide: user.siteRole === "site_admin" };
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const formData = await request.formData();
	const result = formSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Check the post details" };
	const eventResult = result.data.section === "events" ? parseEventDetails(formData) : null;
	if (eventResult && !eventResult.success) return { ok: false as const, error: eventResult.error.issues[0]?.message ?? "Check the event details" };
	try {
		const created = await createPost(context.cloudflare.env, user, {
			...result.data,
			section: sectionDefinitions[result.data.section].databaseValue,
			tags: normalizeTags(result.data.tags),
			event: eventResult?.data,
		});
		throw redirect(`/posts/${created.id}`);
	} catch (error) {
		if (error instanceof Response) throw error;
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
	return <div className="post-editor-page"><section className="page-heading"><div><p className="eyebrow">{loaderData.definition.eyebrow}</p><h1>{loaderData.definition.action}</h1><p>{loaderData.section === "events" ? "Submit an event with the details moderators need to review and publish it." : "Create a focused post for the people and organizations who should see it."}</p></div></section><PostEditor allowEcosystemWide={loaderData.allowEcosystemWide} message={actionData ? { ok: actionData.ok, text: actionData.ok ? "" : actionData.error } : undefined} organizations={loaderData.organizations} section={loaderData.section} submitting={navigation.state === "submitting"} /></div>;
}
