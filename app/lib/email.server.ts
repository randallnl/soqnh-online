const SENDER_NAME = "State of Queer NH";

type InvitationRole = "viewer" | "contributor" | "org_admin";

const invitationRoleLabels: Record<InvitationRole, string> = {
	viewer: "Member",
	contributor: "Contributor",
	org_admin: "Organization administrator",
};

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

export async function sendInvitationEmail(
	env: Env,
	input: {
		to: string;
		token: string;
		organizationName: string | null;
		invitedRole: InvitationRole;
		invitedByName: string | null;
	},
) {
	const appOrigin = env.APP_ORIGIN.replace(/\/$/, "");
	const url = new URL("/invite/accept", appOrigin);
	url.searchParams.set("token", input.token);
	const link = url.toString();
	const content = createInvitationEmailContent({ ...input, link });

	return env.EMAIL.send({
		to: input.to,
		from: { email: env.EMAIL_FROM, name: SENDER_NAME },
		subject: content.subject,
		text: content.text,
		html: content.html,
	});
}

export function createInvitationEmailContent(input: {
	link: string;
	organizationName: string | null;
	invitedRole: InvitationRole;
	invitedByName: string | null;
}) {
	const roleLabel = invitationRoleLabels[input.invitedRole];
	const invitationContext = input.organizationName
		? `You are invited to participate as a ${roleLabel} with ${input.organizationName}.`
		: "You are invited to join the statewide member network.";
	const inviterCopy = input.invitedByName
		? `${input.invitedByName} invited you to join.`
		: "A State of Queer NH administrator invited you to join.";
	const safeLink = escapeHtml(input.link);
	const safeContext = escapeHtml(invitationContext);
	const safeInviter = escapeHtml(inviterCopy);
	const subject = "You’re invited to State of Queer NH";

	return {
		subject,
		text: [
			"You’re invited to State of Queer NH",
			"",
			inviterCopy,
			invitationContext,
			"",
			"State of Queer NH is a private coordination workspace for New Hampshire’s queer community network. Members can share updates, coordinate projects, find community events, and connect with organizations in their network.",
			"",
			"What happens next:",
			"1. Open the secure invitation link below.",
			"2. Confirm your name and activate your account.",
			"3. Complete your member profile before entering the workspace.",
			"4. You will see content and organizations available through your affiliations and approved organization memberships.",
			"",
			"Accept your invitation:",
			input.link,
			"",
			"This link is single-use and expires in 7 days. Please do not forward it. Your affiliation assignments are private and are visible only to you and site administrators.",
			"",
			"If you were not expecting this invitation, you can safely ignore this email or contact the person who invited you.",
		].join("\n"),
		html: [
			'<div style="margin:0;padding:32px 20px;background:#f6f8f6;color:#14231f;font-family:Arial,sans-serif;line-height:1.6">',
			'<div style="max-width:620px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #d8e0dc;border-radius:14px">',
			'<p style="margin:0 0 8px;color:#266d5e;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Private community invitation</p>',
			'<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:30px;line-height:1.2">You’re invited to State of Queer NH</h1>',
			`<p style="margin:0 0 8px"><strong>${safeInviter}</strong></p>`,
			`<p style="margin:0 0 22px">${safeContext}</p>`,
			'<p style="margin:0 0 22px">State of Queer NH is a private coordination workspace for New Hampshire’s queer community network. Members can share updates, coordinate projects, find community events, and connect with organizations in their network.</p>',
			'<h2 style="margin:0 0 10px;font-family:Georgia,serif;font-size:20px">What happens next</h2>',
			'<ol style="margin:0 0 24px;padding-left:22px"><li>Open your secure invitation.</li><li>Confirm your name and activate your account.</li><li>Complete your member profile.</li><li>Enter the workspace and see content available through your approved network.</li></ol>',
			`<p style="margin:0 0 24px"><a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#1d5a4e;color:#ffffff;font-weight:700;text-decoration:none">Accept your invitation</a></p>`,
			'<div style="padding:16px;border-radius:10px;background:#edf6f2;font-size:14px"><strong>Privacy and security</strong><p style="margin:6px 0 0">This link is single-use and expires in 7 days. Please do not forward it. Your affiliation assignments are visible only to you and site administrators.</p></div>',
			`<p style="margin:20px 0 0;color:#5a6f68;font-size:13px">If the button does not work, copy and paste this address into your browser:<br><a href="${safeLink}" style="color:#266d5e;word-break:break-all">${safeLink}</a></p>`,
			'<p style="margin:18px 0 0;color:#5a6f68;font-size:13px">If you were not expecting this invitation, you can safely ignore this email or contact the person who invited you.</p>',
			"</div></div>",
		].join(""),
	};
}
