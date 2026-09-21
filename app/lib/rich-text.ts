export type ExternalUrlMatch = {
	index: number;
	text: string;
	href: string;
};

const externalUrlPattern = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;
const simpleTrailingPunctuation = /[.,!?;:]+$/u;

function count(value: string, character: string) {
	return [...value].filter((item) => item === character).length;
}

function trimTrailingPunctuation(value: string) {
	let trimmed = value.replace(simpleTrailingPunctuation, "");
	const pairs = [["(", ")"], ["[", "]"], ["{", "}"]] as const;
	for (const [opening, closing] of pairs) {
		while (trimmed.endsWith(closing) && count(trimmed, closing) > count(trimmed, opening)) {
			trimmed = trimmed.slice(0, -1);
		}
	}
	return trimmed.replace(simpleTrailingPunctuation, "");
}

export function findExternalUrls(value: string): ExternalUrlMatch[] {
	return [...value.matchAll(externalUrlPattern)].flatMap((match) => {
		const text = trimTrailingPunctuation(match[0]);
		if (!text) return [];
		return [{
			index: match.index,
			text,
			href: /^www\./i.test(text) ? `https://${text}` : text,
		}];
	});
}
