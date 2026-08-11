import { redirect } from "react-router";

import type { Route } from "./+types/auth-verify";
import { sanitizeReturnTo } from "~/lib/auth";
import {
	consumeLoginToken,
	createUserSession,
} from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);
	const token = url.searchParams.get("token");
	const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));
	if (!token) throw redirect("/login?error=invalid-link");

	const user = await consumeLoginToken(context.cloudflare.env, token);
	if (!user) throw redirect("/login?error=invalid-link");

	const cookie = await createUserSession(context.cloudflare.env, user);
	throw redirect(returnTo, { headers: { "Set-Cookie": cookie } });
}
