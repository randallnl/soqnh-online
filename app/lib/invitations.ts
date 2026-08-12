export const organizationRoles = [
	"viewer",
	"contributor",
	"org_admin",
] as const;

export type OrganizationRole = (typeof organizationRoles)[number];
