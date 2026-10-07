import type { Route } from "./+types/public-spotlight-media";
import { getPublicSpotlightImageKey } from "~/models/public-spotlights.server";

export async function loader({ context, params }: Route.LoaderArgs) {
	const key = await getPublicSpotlightImageKey(context.cloudflare.env, params.spotlightId);
	if (!key?.startsWith("spotlight-images/")) throw new Response("Not found", { status: 404 });
	const object = await context.cloudflare.env.ASSETS.get(key);
	if (!object) throw new Response("Not found", { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	if (!headers.get("Content-Type")?.startsWith("image/")) throw new Response("Not found", { status: 404 });
	headers.set("ETag", object.httpEtag);
	headers.set("Cache-Control", "public, max-age=300");
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(object.body, { headers });
}
