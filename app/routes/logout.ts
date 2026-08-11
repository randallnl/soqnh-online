import { redirect } from "react-router";

import type { Route } from "./+types/logout";
import { revokeUserSession } from "~/lib/auth.server";
import { requireSameOrigin } from "~/lib/http.server";

export function loader() {
	throw redirect("/");
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const cookie = await revokeUserSession(request, context.cloudflare.env);
	throw redirect("/login", { headers: { "Set-Cookie": cookie } });
}
