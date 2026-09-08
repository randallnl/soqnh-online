import { Link } from "react-router";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type MentionTarget = {
	id: string;
	type: "person" | "organization";
	label: string;
	detail?: string | null;
	href: string;
};

type ActiveMention = { start: number; end: number; query: string };

function activeMention(value: string, caret: number): ActiveMention | null {
	const beforeCaret = value.slice(0, caret);
	const match = beforeCaret.match(/(?:^|[^\p{L}\p{N}_@])@([^@\n]*)$/u);
	if (!match || match[1].length > 80) return null;
	const at = beforeCaret.lastIndexOf("@");
	return { start: at, end: caret, query: match[1].trimStart().toLocaleLowerCase() };
}

export function MentionTextarea({
	id,
	name = "body",
	defaultValue = "",
	defaultMentionUserIds = [],
	targets,
	maxLength,
	minLength,
	placeholder,
	rows,
	required,
}: {
	id: string;
	name?: string;
	defaultValue?: string;
	defaultMentionUserIds?: string[];
	targets: MentionTarget[];
	maxLength?: number;
	minLength?: number;
	placeholder?: string;
	rows?: number;
	required?: boolean;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [value, setValue] = useState(defaultValue);
	const [selectedPersonIds, setSelectedPersonIds] = useState(() => new Set(defaultMentionUserIds));
	const [mention, setMention] = useState<ActiveMention | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);

	const suggestions = useMemo(() => {
		if (!mention) return [];
		const query = mention.query;
		return targets.filter((target) => !query || `${target.label} ${target.detail ?? ""}`.toLocaleLowerCase().includes(query)).slice(0, 8);
	}, [mention, targets]);
	const selectedPeople = targets.filter((target) => target.type === "person" && selectedPersonIds.has(target.id) && value.includes(`@${target.label}`));

	function refreshMention(nextValue: string, caret: number) {
		const nextMention = activeMention(nextValue, caret);
		setMention(nextMention);
		setActiveIndex(0);
	}

	function choose(target: MentionTarget) {
		if (!mention) return;
		const nextValue = `${value.slice(0, mention.start)}@${target.label} ${value.slice(mention.end)}`;
		const nextCaret = mention.start + target.label.length + 2;
		setValue(nextValue);
		if (target.type === "person") setSelectedPersonIds((ids) => new Set(ids).add(target.id));
		setMention(null);
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
			textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
		});
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (!mention || suggestions.length === 0) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
		} else if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			choose(suggestions[activeIndex] ?? suggestions[0]);
		} else if (event.key === "Escape") {
			event.preventDefault();
			setMention(null);
		}
	}

	return <div className="mention-input">
		<textarea
			aria-autocomplete="list"
			aria-controls={`${id}-mentions`}
			aria-expanded={mention !== null && suggestions.length > 0}
			autoComplete="off"
			id={id}
			maxLength={maxLength}
			minLength={minLength}
			name={name}
			onChange={(event) => {
				const nextValue = event.currentTarget.value;
				setValue(nextValue);
				setSelectedPersonIds((ids) => new Set([...ids].filter((id) => {
					const target = targets.find((item) => item.id === id && item.type === "person");
					return target ? nextValue.includes(`@${target.label}`) : false;
				})));
				refreshMention(nextValue, event.currentTarget.selectionStart);
			}}
			onClick={(event) => refreshMention(event.currentTarget.value, event.currentTarget.selectionStart)}
			onKeyDown={handleKeyDown}
			placeholder={placeholder}
			ref={textareaRef}
			required={required}
			rows={rows}
			value={value}
		/>
		{selectedPeople.map((target) => <input key={target.id} name="mentionUserId" type="hidden" value={target.id} />)}
		{mention && suggestions.length > 0 && <div className="mention-suggestions" id={`${id}-mentions`} role="listbox">
			{suggestions.map((target, index) => <button
				aria-selected={index === activeIndex}
				className={index === activeIndex ? "mention-suggestion mention-suggestion--active" : "mention-suggestion"}
				key={`${target.type}-${target.id}`}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => choose(target)}
				role="option"
				type="button"
			><span><strong>{target.label}</strong>{target.detail && <small>{target.detail}</small>}</span><em>{target.type === "person" ? "Person" : "Organization"}</em></button>)}
		</div>}
	</div>;
}

function escapePattern(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function MentionText({ text, targets }: { text: string; targets: MentionTarget[] }) {
	const uniqueTargets = [...new Map(targets.map((target) => [target.label.toLocaleLowerCase(), target])).values()]
		.sort((a, b) => b.label.length - a.label.length);
	const pattern = uniqueTargets.length > 0 ? new RegExp(`@(${uniqueTargets.map((target) => escapePattern(target.label)).join("|")})(?![\\p{L}\\p{N}_])`, "giu") : null;
	return <>{text.split(/\n{2,}/).map((paragraph, paragraphIndex) => {
		if (!pattern) return <p key={`${paragraphIndex}-${paragraph.slice(0, 20)}`}>{paragraph}</p>;
		const pieces: ReactNode[] = [];
		let lastIndex = 0;
		for (const match of paragraph.matchAll(pattern)) {
			const index = match.index;
			if (index > lastIndex) pieces.push(paragraph.slice(lastIndex, index));
			const target = uniqueTargets.find((item) => item.label.toLocaleLowerCase() === match[1].toLocaleLowerCase());
			pieces.push(target ? <Link className="inline-mention" key={`${index}-${target.type}-${target.id}`} to={target.href}>@{match[1]}</Link> : match[0]);
			lastIndex = index + match[0].length;
		}
		if (lastIndex < paragraph.length) pieces.push(paragraph.slice(lastIndex));
		return <p key={`${paragraphIndex}-${paragraph.slice(0, 20)}`}>{pieces}</p>;
	})}</>;
}
