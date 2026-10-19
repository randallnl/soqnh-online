import { useFetcher } from "react-router";

import { Icon } from "./icon";

type SupportActionData =
	| { ok: true; intent: "toggle-support"; postId: string; supported: boolean; supportCount: number }
	| { ok: false; error: string };

export function SupportButton({
	postId,
	initialSupported,
	initialCount,
	size = 15,
}: {
	postId: string;
	initialSupported: boolean;
	initialCount: number;
	size?: number;
}) {
	const fetcher = useFetcher<SupportActionData>();
	const latest = fetcher.data?.ok && fetcher.data.intent === "toggle-support" && fetcher.data.postId === postId
		? fetcher.data
		: null;
	const settledSupported = latest?.supported ?? initialSupported;
	const settledCount = latest?.supportCount ?? initialCount;
	const pending = fetcher.state !== "idle";
	const supported = pending ? !settledSupported : settledSupported;
	const supportCount = pending ? Math.max(0, settledCount + (supported ? 1 : -1)) : settledCount;
	const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

	return <fetcher.Form className="support-action" method="post">
		<input name="intent" type="hidden" value="toggle-support" />
		<input name="postId" type="hidden" value={postId} />
		<button
			aria-label={`${supported ? "Remove support from" : "Support"} this post`}
			aria-pressed={supported}
			className={`support-button${supported ? " support-button--active" : ""}${pending ? " support-button--pending" : ""}`}
			disabled={pending}
			type="submit"
		>
			<Icon name="heart" size={size} /> {supported ? "Supported" : "Support"} · {supportCount}
		</button>
		<span aria-live="polite" className="sr-only" role="status">
			{pending ? "Updating support." : error ?? (latest ? supported ? "Support added." : "Support removed." : "")}
		</span>
	</fetcher.Form>;
}
