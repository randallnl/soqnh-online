export function ensureSubmissionId(form: HTMLFormElement) {
	const input = form.elements.namedItem("submissionId");
	if (input instanceof HTMLInputElement && !input.value) input.value = crypto.randomUUID();
}
