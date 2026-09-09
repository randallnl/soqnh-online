export const contentSections = ["legislation", "events", "projects", "updates"] as const;
export const eventTimings = ["upcoming", "past", "all"] as const;
export const postVisibilities = ["members", "organization"] as const;
export const postStatuses = ["draft", "published"] as const;

export type ContentSection = (typeof contentSections)[number];
export type DatabaseSection = "legislation" | "event" | "project" | "update";
export type EventTiming = (typeof eventTimings)[number];
export type PostVisibility = (typeof postVisibilities)[number];
export type EditablePostStatus = (typeof postStatuses)[number];

export const sectionDefinitions = {
	legislation: {
		databaseValue: "legislation",
		title: "Legislation",
		eyebrow: "Policy intelligence",
		description: "Track the issues that matter, coordinate testimony, and turn policy updates into shared action.",
		action: "Add legislation update",
		icon: "gavel",
	},
	events: {
		databaseValue: "event",
		title: "Events",
		eyebrow: "Across New Hampshire",
		description: "Share gatherings, trainings, actions, and moments of community across the network. Add events manually, or add your events page URL to your organization profile to sync them automatically.",
		action: "Create event post",
		icon: "calendar",
	},
	projects: {
		databaseValue: "project",
		title: "Projects",
		eyebrow: "Work in motion",
		description: "Make shared initiatives visible, find collaborators, and keep momentum across organizations.",
		action: "Start a project post",
		icon: "clipboard",
	},
	updates: {
		databaseValue: "update",
		title: "Community Feed",
		eyebrow: "Community feed",
		description: "Share news, requests, resources, and wins with the people who should see them.",
		action: "Write an update",
		icon: "message",
	},
} as const satisfies Record<ContentSection, {
	databaseValue: DatabaseSection;
	title: string;
	eyebrow: string;
	description: string;
	action: string;
	icon: "gavel" | "calendar" | "clipboard" | "message";
}>;

export function isContentSection(value: string | undefined): value is ContentSection {
	return contentSections.includes(value as ContentSection);
}

export function isEventTiming(value: string | null): value is EventTiming {
	return eventTimings.includes(value as EventTiming);
}

export function routeSectionForDatabase(value: DatabaseSection): ContentSection {
	return value === "event" ? "events" : value === "project" ? "projects" : value === "update" ? "updates" : "legislation";
}

export function normalizeTags(value: string) {
	return [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-")).filter((tag) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(tag)))].slice(0, 8);
}

export function communityUpdateTitle(body: string) {
	const firstLine = body.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() || "Community update";
	return firstLine.length <= 100 ? firstLine : `${firstLine.slice(0, 97).trimEnd()}…`;
}
