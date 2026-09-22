export function sanitizeReturnTo(value: FormDataEntryValue | string | null) {
	if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
		return "/home";
	}

	try {
		const url = new URL(value, "https://soqnh.invalid");
		if (url.origin !== "https://soqnh.invalid") return "/home";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/home";
	}
}
