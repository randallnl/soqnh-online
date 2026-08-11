const SENDER_NAME = "State of Queer NH";

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

export async function sendMagicLinkEmail(
	env: Env,
	input: {
		to: string;
		token: string;
		returnTo: string;
	},
) {
	const appOrigin = env.APP_ORIGIN.replace(/\/$/, "");
	const url = new URL("/auth/verify", appOrigin);
	url.searchParams.set("token", input.token);
	url.searchParams.set("returnTo", input.returnTo);
	const link = url.toString();
	const safeLink = escapeHtml(link);

	return env.EMAIL.send({
		to: input.to,
		from: { email: env.EMAIL_FROM, name: SENDER_NAME },
		subject: "Your State of Queer NH sign-in link",
		text: [
			"Sign in to State of Queer NH:",
			link,
			"",
			"This one-time link expires in 15 minutes. If you did not request it, you can ignore this email.",
		].join("\n"),
		html: [
			"<p>Sign in to State of Queer NH:</p>",
			`<p><a href="${safeLink}">Open the private workspace</a></p>`,
			"<p>This one-time link expires in 15 minutes. If you did not request it, you can ignore this email.</p>",
		].join(""),
	});
}
