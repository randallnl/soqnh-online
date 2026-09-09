import type { Route } from "./+types/media";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { getContentImagePostId } from "~/models/attachments.server";
import { getPostById } from "~/models/posts.server";
import { canReadIdentityObject } from "~/models/profiles.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const key = params["*"];
	if (!key) throw new Response("Not found", { status: 404 });
	const identityReadable = await canReadIdentityObject(context.cloudflare.env, user, key);
	const contentPostId = identityReadable ? null : await getContentImagePostId(context.cloudflare.env, key);
	const contentReadable = contentPostId ? await getPostById(context.cloudflare.env, user, contentPostId) : null;
	if (!identityReadable && !contentReadable) throw new Response("Not found", { status: 404 });
	const object = await context.cloudflare.env.ASSETS.get(key);
	if (!object) throw new Response("Not found", { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("ETag", object.httpEtag);
	headers.set("Cache-Control", "private, max-age=3600");
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(object.body, { headers });
}
