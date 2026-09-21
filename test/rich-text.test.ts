import { describe, expect, it } from "vitest";

import { findExternalUrls } from "../app/lib/rich-text";

describe("findExternalUrls", () => {
	it("finds secure and www-style URLs", () => {
		expect(findExternalUrls("Details: https://example.org/events and www.example.com/about")).toEqual([
			{ index: 9, text: "https://example.org/events", href: "https://example.org/events" },
			{ index: 40, text: "www.example.com/about", href: "https://www.example.com/about" },
		]);
	});

	it("keeps sentence punctuation outside links", () => {
		expect(findExternalUrls("See https://example.org/event?id=4. Then (https://example.org/info)." )).toEqual([
			{ index: 4, text: "https://example.org/event?id=4", href: "https://example.org/event?id=4" },
			{ index: 42, text: "https://example.org/info", href: "https://example.org/info" },
		]);
	});

	it("does not link unsafe or non-web protocols", () => {
		expect(findExternalUrls("javascript:alert(1) mailto:test@example.org example.org")).toEqual([]);
	});
});
