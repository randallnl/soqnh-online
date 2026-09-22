import type { Route } from "./+types/public-organization-media";
import { getPublishedOrganizationMediaKey } from "~/models/public-directory.server";

export async function loader({ context, params }: Route.LoaderArgs) {
	const kind = params.kind;
	if (kind !== "logo" && kind !== "photo") {
		throw new Response("Not found", { status: 404 });
	}
	const key = await getPublishedOrganizationMediaKey(
		context.cloudflare.env,
		params.slug,
		kind,
	);
	if (!key) throw new Response("Not found", { status: 404 });

	const object = await context.cloudflare.env.ASSETS.get(key);
	if (!object) throw new Response("Not found", { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	if (!headers.get("Content-Type")?.startsWith("image/")) {
		throw new Response("Not found", { status: 404 });
	}
	headers.set("ETag", object.httpEtag);
	headers.set("Cache-Control", "public, max-age=300");
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(object.body, { headers });
}
