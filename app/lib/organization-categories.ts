export const organizationCategoryOptions = [
	"Arts & Culture",
	"Community & Advocacy",
	"Education & Learning",
	"Events & Nightlife",
	"Food & Drink",
	"Health & Wellness",
	"Shops & Services",
	"Artist or Creative",
	"Resource Listing",
	"Other",
] as const;

const categoryTones = ["plum", "rose", "blue", "coral", "gold", "green"] as const;

const categoryToneByName: Record<string, typeof categoryTones[number]> = {
	"Arts & Culture": "plum",
	"Community & Advocacy": "rose",
	"Education & Learning": "blue",
	"Events & Nightlife": "coral",
	"Food & Drink": "gold",
	"Health & Wellness": "green",
	"Shops & Services": "blue",
	"Artist or Creative": "plum",
	"Resource Listing": "green",
	Other: "gold",
};

export function parseOrganizationCategories(value: string | null | undefined) {
	return [...new Set((value ?? "").split(/\r?\n+/).map((category) => category.trim()).filter(Boolean))].slice(0, 10);
}

export function serializeOrganizationCategories(values: readonly unknown[]) {
	return [...new Set(values
		.filter((value): value is string => typeof value === "string")
		.flatMap((value) => parseOrganizationCategories(value))
		.map((category) => category.slice(0, 120)))]
		.slice(0, 10)
		.join("\n");
}

export function organizationCategoryTone(category: string) {
	const knownTone = categoryToneByName[category];
	if (knownTone) return knownTone;
	const hash = [...category].reduce((total, character) => total + character.charCodeAt(0), 0);
	return categoryTones[hash % categoryTones.length];
}
