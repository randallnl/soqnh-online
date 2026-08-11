import type { Route } from "./+types/section";
import { Icon, type IconName } from "~/components/icon";
import { requireAuthenticatedUser } from "~/lib/auth.server";

type SectionDefinition = {
	title: string;
	eyebrow: string;
	description: string;
	action: string;
	icon: IconName;
	items: Array<{ title: string; copy: string }>;
};

const sections: Record<string, SectionDefinition> = {
	legislation: {
		title: "Legislation",
		eyebrow: "Policy intelligence",
		description: "Track the issues that matter, coordinate testimony, and turn policy updates into shared action.",
		action: "Add legislation update",
		icon: "gavel",
		items: [
			{ title: "Policy feed", copy: "Briefings, status changes, and action requests." },
			{ title: "Shared filters", copy: "Organize work by topic, status, and affiliation." },
			{ title: "Discussion", copy: "Keep questions and next steps with the update." },
		],
	},
	events: {
		title: "Events",
		eyebrow: "Across New Hampshire",
		description: "A shared calendar for gatherings, trainings, actions, and moments of community.",
		action: "Create event",
		icon: "calendar",
		items: [
			{ title: "Moderation queue", copy: "Review manual and partner-imported events." },
			{ title: "Calendar views", copy: "Move between upcoming, monthly, and list views." },
			{ title: "Partner sources", copy: "Track provenance and prevent duplicate imports." },
		],
	},
	projects: {
		title: "Projects",
		eyebrow: "Work in motion",
		description: "Make shared initiatives visible, find collaborators, and keep momentum across organizations.",
		action: "Start a project",
		icon: "clipboard",
		items: [
			{ title: "Project profiles", copy: "Goals, leads, milestones, and current status." },
			{ title: "Collaboration", copy: "Invite members and participating organizations." },
			{ title: "Progress updates", copy: "Keep the ecosystem informed without extra meetings." },
		],
	},
	updates: {
		title: "Updates",
		eyebrow: "Community feed",
		description: "Share news, requests, resources, and wins with the people who should see them.",
		action: "Write an update",
		icon: "message",
		items: [
			{ title: "Affiliation-aware feed", copy: "Visibility follows the community graph." },
			{ title: "Mentions", copy: "Bring people and organizations into context." },
			{ title: "Reactions and comments", copy: "Lightweight ways to engage and respond." },
		],
	},
	organizations: {
		title: "Organizations",
		eyebrow: "Community directory",
		description: "Understand who is here, what they do, and how people and coalitions connect.",
		action: "Add organization",
		icon: "building",
		items: [
			{ title: "Organization profiles", copy: "Mission, links, logo, and public points of contact." },
			{ title: "Membership roles", copy: "Admins, contributors, and viewers with clear scopes." },
			{ title: "Affiliations", copy: "Coalitions and networks power visibility rules." },
		],
	},
	members: {
		title: "Members",
		eyebrow: "People of the ecosystem",
		description: "A people-first directory shaped by privacy choices and shared affiliations.",
		action: "Invite member",
		icon: "people",
		items: [
			{ title: "Member profiles", copy: "Photos, pronouns, bio, and organization context." },
			{ title: "Privacy controls", copy: "Members decide how broadly their profile appears." },
			{ title: "Connections", copy: "Shared affiliations unlock appropriate discovery." },
		],
	},
	notifications: {
		title: "Notifications",
		eyebrow: "Stay in the loop",
		description: "Mentions, replies, invitations, and moderation work in one manageable inbox.",
		action: "Notification settings",
		icon: "bell",
		items: [
			{ title: "Mentions", copy: "See when someone brings you into a conversation." },
			{ title: "Moderation", copy: "Keep approvals moving without checking every page." },
			{ title: "Digests", copy: "Optional email summaries reduce notification noise." },
		],
	},
	profile: {
		title: "Your profile",
		eyebrow: "Member identity",
		description: "Control how you appear across the ecosystem and what other members can discover.",
		action: "Edit profile",
		icon: "user",
		items: [
			{ title: "Profile details", copy: "Name, pronouns, bio, photo, and contact preferences." },
			{ title: "Organizations", copy: "Review your roles and active memberships." },
			{ title: "Visibility", copy: "Choose ecosystem, affiliation, or organization scope." },
		],
	},
};

export async function loader({ request, context, params }: Route.LoaderArgs) {
	await requireAuthenticatedUser(request, context.cloudflare.env);
	const section = params.section ? sections[params.section] : undefined;
	if (!section) throw new Response("Not found", { status: 404 });
	return { section };
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: `${data?.section.title ?? "Workspace"} · State of Queer NH` }];
}

export default function Section({ loaderData }: Route.ComponentProps) {
	const { section } = loaderData;

	return (
		<div className="section-page">
			<section className="section-hero">
				<div className="section-hero-copy">
					<span className="section-hero-icon"><Icon name={section.icon} size={24} /></span>
					<div>
						<p className="eyebrow">{section.eyebrow}</p>
						<h1>{section.title}</h1>
						<p>{section.description}</p>
					</div>
				</div>
				<button className="button button--primary" type="button"><Icon name="plus" size={17} />{section.action}</button>
			</section>

			<section className="panel foundation-panel">
				<div className="foundation-intro">
					<span><Icon name="sparkles" size={20} /></span>
					<div>
						<p className="eyebrow">Foundation preview</p>
						<h2>This workspace is ready for its feature slice.</h2>
						<p>The routing, responsive shell, Cloudflare bindings, and permission model are in place. These are the next capabilities designed for this section.</p>
					</div>
				</div>
				<div className="foundation-grid">
					{section.items.map((item, index) => (
						<article key={item.title}>
							<span>{String(index + 1).padStart(2, "0")}</span>
							<h3>{item.title}</h3>
							<p>{item.copy}</p>
						</article>
					))}
				</div>
			</section>

			<div className="section-footer-card">
				<div><strong>Want to check the platform foundation?</strong><p>Open the live JSON health route for D1 and binding status.</p></div>
				<a className="button button--secondary" href="/health">View health check <Icon name="chevron-right" size={17} /></a>
			</div>
		</div>
	);
}
