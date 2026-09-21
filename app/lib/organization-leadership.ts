export const organizationLeadershipOptions = [
	"Queer-led",
	"BIPOC-led",
	"Not queer/BIPOC-led",
	"Not sure",
	"Prefer not to say",
] as const;

export type OrganizationLeadership = typeof organizationLeadershipOptions[number];

const statusOptions = new Set<OrganizationLeadership>([
	"Not queer/BIPOC-led",
	"Not sure",
	"Prefer not to say",
]);

function canonicalValue(value: string): OrganizationLeadership | null {
	const normalized = value.trim().toLocaleLowerCase();
	if (normalized === "queer-led" || normalized === "yes, queer-led") return "Queer-led";
	if (normalized === "bipoc-led" || normalized === "yes, bipoc-led") return "BIPOC-led";
	if (normalized === "not queer/bipoc-led" || normalized === "no") return "Not queer/BIPOC-led";
	if (normalized === "not sure") return "Not sure";
	if (normalized === "prefer not to say") return "Prefer not to say";
	return null;
}

export function parseOrganizationLeadership(value: string | null | undefined) {
	const raw = value?.trim();
	if (!raw) return [];
	const normalized = raw.toLocaleLowerCase();
	if (normalized === "yes, both" || (normalized.includes("queer-led") && normalized.includes("bipoc-led"))) {
		return ["Queer-led", "BIPOC-led"];
	}
	return [...new Set(raw.split(/[;\n]+/).map((item) => canonicalValue(item) ?? item.trim()).filter(Boolean))].slice(0, 5);
}

export function isOrganizationLeadershipStatus(value: string): value is OrganizationLeadership {
	return statusOptions.has(value as OrganizationLeadership);
}

export function serializeOrganizationLeadership(values: readonly unknown[]) {
	const selected = [...new Set(values
		.filter((value): value is string => typeof value === "string")
		.map((value) => canonicalValue(value) ?? value.trim().slice(0, 100))
		.filter(Boolean))];
	const status = selected.find(isOrganizationLeadershipStatus);
	if (status) return status;
	const identities = selected.filter((value) => value === "Queer-led" || value === "BIPOC-led");
	return (identities.length > 0 ? identities : selected.slice(0, 1)).join("\n");
}
