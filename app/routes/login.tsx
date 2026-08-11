import { useState } from "react";
import {
	Form,
	Link,
	redirect,
	useActionData,
	useNavigation,
	useSearchParams,
} from "react-router";
import { z } from "zod";

import type { Route } from "./+types/login";
import { Icon } from "~/components/icon";
import { sanitizeReturnTo } from "~/lib/auth";
import {
	auditAuthenticationFailure,
	getAuthenticatedUser,
	invalidateLoginToken,
	issueLoginToken,
} from "~/lib/auth.server";
import { sendMagicLinkEmail } from "~/lib/email.server";
import { requireSameOrigin } from "~/lib/http.server";

const requestAccessSchema = z.object({
	email: z.email("Enter a valid email address"),
});

async function deliverMagicLink(
	env: Env,
	loginToken: NonNullable<Awaited<ReturnType<typeof issueLoginToken>>>,
	returnTo: string,
) {
	try {
		await sendMagicLinkEmail(env, {
			to: loginToken.user.email,
			token: loginToken.token,
			returnTo,
		});
	} catch (error) {
		try {
			await invalidateLoginToken(env, loginToken.tokenHash);
			await auditAuthenticationFailure(
				env,
				loginToken.user.id,
				"auth.magic_link_delivery_failed",
			);
		} catch (cleanupError) {
			console.error(
				JSON.stringify({
					message: "magic link failure cleanup failed",
					userId: loginToken.user.id,
					error:
						cleanupError instanceof Error
							? cleanupError.message
							: String(cleanupError),
				}),
			);
		}
		console.error(
			JSON.stringify({
				message: "magic link delivery failed",
				userId: loginToken.user.id,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Sign in · State of Queer NH" },
		{
			name: "description",
			content: "Sign in to the private State of Queer NH workspace.",
		},
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const returnTo = sanitizeReturnTo(new URL(request.url).searchParams.get("returnTo"));
	const user = await getAuthenticatedUser(request, context.cloudflare.env);
	if (user) throw redirect(returnTo);
	return null;
}

export async function action({ request, context }: Route.ActionArgs) {
	requireSameOrigin(request);
	const formData = await request.formData();
	const result = requestAccessSchema.safeParse({ email: formData.get("email") });
	const returnTo = sanitizeReturnTo(formData.get("returnTo"));

	if (!result.success) {
		return {
			ok: false as const,
			error: result.error.issues[0]?.message ?? "Check your email address",
		};
	}

	try {
		const loginToken = await issueLoginToken(
			context.cloudflare.env,
			result.data.email,
		);

		if (loginToken) {
			context.cloudflare.ctx.waitUntil(
				deliverMagicLink(context.cloudflare.env, loginToken, returnTo),
			);
		}
	} catch (error) {
		console.error(
			JSON.stringify({
				message: "magic link request failed",
				error: error instanceof Error ? error.message : String(error),
			}),
		);
	}

	return {
		ok: true as const,
		message:
			"If that address has active member access, a sign-in link is on its way.",
	};
}

export default function Login() {
	const actionData = useActionData<typeof action>();
	const navigation = useNavigation();
	const [searchParams] = useSearchParams();
	const [email, setEmail] = useState("");
	const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
	const error = searchParams.get("error");
	const linkError =
		error === "invalid-link"
			? "That sign-in link is invalid, expired, or has already been used."
			: error === "account-unavailable"
				? "This account is not currently able to sign in."
				: null;
	const submitting = navigation.state === "submitting";

	return (
		<main className="auth-page">
			<section className="auth-story">
				<div className="auth-story-inner">
					<Link className="brand-lockup" to="/">
						<span className="brand-mark" aria-hidden="true"><span /><span /></span>
						<span><strong>State of Queer</strong><small>New Hampshire</small></span>
					</Link>
					<div className="auth-quote">
						<span className="auth-quote-icon"><Icon name="heart" size={24} /></span>
						<p className="eyebrow">Stronger connections, shared power</p>
						<h1>One place for New Hampshire’s queer community to organize.</h1>
						<p>
							Coordinate across organizations, share important updates, and find the people already doing the work.
						</p>
					</div>
					<p className="auth-footer">Private by design · Built for the ecosystem</p>
				</div>
			</section>

			<section className="auth-form-section">
				<div className="auth-form-card">
					<p className="eyebrow">Member access</p>
					<h2>Welcome back</h2>
					<p>Enter your invited email address and we’ll send you a secure sign-in link.</p>

					<Form className="auth-form" method="post">
						<input name="returnTo" type="hidden" value={returnTo} />
						<label htmlFor="email">Email address</label>
						<div className="input-with-icon">
							<Icon name="message" size={18} />
							<input
								autoComplete="email"
								id="email"
								name="email"
								onChange={(event) => setEmail(event.currentTarget.value)}
								placeholder="you@example.org"
								required
								type="email"
								value={email}
							/>
						</div>
						{actionData && !actionData.ok && <p className="form-message form-message--error">{actionData.error}</p>}
						{linkError && <p className="form-message form-message--error">{linkError}</p>}
						{actionData?.ok && <p className="form-message form-message--success">{actionData.message}</p>}
						<button className="button button--primary button--large" disabled={submitting} type="submit">
							{submitting ? "Sending…" : "Email me a sign-in link"}
							<Icon name="chevron-right" size={18} />
						</button>
					</Form>

					<div className="auth-divider"><span>Access is invitation-only</span></div>
					<p className="auth-help">Need access? Ask an ecosystem administrator for an invitation.</p>
				</div>
			</section>
		</main>
	);
}
