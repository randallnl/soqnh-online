export const auditEntityTypes = [
	"user",
	"organization",
	"affiliation",
	"invitation",
	"post",
	"comment",
	"event",
	"session",
	"scraper_run",
] as const;

export type AuditEntityType = (typeof auditEntityTypes)[number];
