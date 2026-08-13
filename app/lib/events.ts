import { z } from "zod";

const optionalText = (maximum: number) => z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : null,
	z.string().max(maximum).nullable(),
);

const optionalUrl = z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : null,
	z.url("Enter a complete URL beginning with https://").max(2048)
		.refine((value) => /^https?:\/\//i.test(value), "Use an http:// or https:// URL")
		.nullable(),
);

export const eventDetailsSchema = z.object({
	startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose an event start date and time"),
	endsAt: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : null,
		z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable(),
	),
	locationName: optionalText(240),
	locationUrl: optionalUrl,
	registrationUrl: optionalUrl,
	sourceUrl: optionalUrl,
	imageUrl: optionalUrl,
}).refine((event) => !event.endsAt || event.endsAt >= event.startsAt, {
	message: "The event end must be after its start",
	path: ["endsAt"],
});

export function parseEventDetails(formData: FormData) {
	return eventDetailsSchema.safeParse(Object.fromEntries(formData));
}

export function eventDateTimeInputValue(value: string | null) {
	if (!value) return "";
	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const parts = new Intl.DateTimeFormat("en-CA", {
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", hourCycle: "h23",
		timeZone: "America/New_York",
	}).formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function formatEventDateTime(value: string) {
	const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	const date = local
		? new Date(Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5])))
		: new Date(value);
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: local ? "UTC" : "America/New_York",
	}).format(date);
}
