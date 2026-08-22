import type { Route } from "./+types/media";
import { requireAuthenticatedUser } from "~/lib/auth.server";
import { canReadIdentityObject } from "~/models/profiles.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request, context.cloudflare.env);
	const key = params["*"];
	if (!key || !await canReadIdentityObject(context.cloudflare.env, user, key)) throw new Response("Not found", { status: 404 });
	const object = await context.cloudflare.env.ASSETS.get(key);
	if (!object) throw new Response("Not found", { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("ETag", object.httpEtag);
	headers.set("Cache-Control", "private, max-age=3600");
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(object.body, { headers });
}
