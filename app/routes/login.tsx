import { useState } from "react";
import { Form, Link, useActionData } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/login";
import { Icon } from "~/components/icon";
import { requireSameOrigin } from "~/lib/http.server";

const requestAccessSchema = z.object({
	email: z.email("Enter a valid email address"),
});

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Sign in · State of Queer NH" },
		{
			name: "description",
			content: "Sign in to the private State of Queer NH workspace.",
		},
	];
}

export async function action({ request }: Route.ActionArgs) {
	requireSameOrigin(request);
	const formData = await request.formData();
	const result = requestAccessSchema.safeParse({ email: formData.get("email") });

	if (!result.success) {
		return {
			ok: false as const,
			error: result.error.issues[0]?.message ?? "Check your email address",
		};
	}

	return {
		ok: true as const,
		message:
			"Your address is valid. Magic-link delivery will activate in the authentication phase.",
	};
}

export default function Login() {
	const actionData = useActionData<typeof action>();
	const [email, setEmail] = useState("");

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
						{actionData?.ok && <p className="form-message form-message--success">{actionData.message}</p>}
						<button className="button button--primary button--large" type="submit">
							Email me a sign-in link
							<Icon name="chevron-right" size={18} />
						</button>
					</Form>

					<div className="auth-divider"><span>Access is invitation-only</span></div>
					<p className="auth-help">Need access? Ask an ecosystem administrator for an invitation.</p>
					<Link className="text-link" to="/">Return to preview dashboard</Link>
				</div>
			</section>
		</main>
	);
}
