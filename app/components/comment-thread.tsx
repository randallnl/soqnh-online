import { Form } from "react-router";

import type { CommentRecord } from "~/models/comments.server";

function initials(name: string | null) {
	return (name || "Member").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function formatCommentDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function CommentItem({ comment, postId, submitting, interactive, reply = false }: { comment: CommentRecord; postId: string; submitting: boolean; interactive: boolean; reply?: boolean }) {
	const edited = comment.updatedAt !== comment.createdAt && comment.status === "published";
	return (
		<article className={`comment-card${reply ? " comment-card--reply" : ""}`} id={`comment-${comment.id}`}>
			<div className="comment-card-meta"><span className="avatar">{initials(comment.authorName)}</span><div><strong>{comment.authorName || "Member"}</strong><p>{formatCommentDate(comment.createdAt)}{edited ? " · edited" : ""}</p></div></div>
			{comment.status === "archived" ? <p className="comment-tombstone">This comment was removed.</p> : <div className="comment-body">{comment.body?.split(/\n{2,}/).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>)}</div>}
			{interactive && comment.status === "published" && <div className="comment-actions">
				{!reply && <details><summary>Reply</summary><Form className="comment-inline-form" method="post"><input name="intent" type="hidden" value="create-comment" /><input name="postId" type="hidden" value={postId} /><input name="parentCommentId" type="hidden" value={comment.id} /><label className="sr-only" htmlFor={`reply-${comment.id}`}>Reply to {comment.authorName || "comment"}</label><textarea id={`reply-${comment.id}`} maxLength={4000} minLength={2} name="body" placeholder="Write a reply…" required rows={3} /><button className="button button--primary button--compact" disabled={submitting} type="submit">Post reply</button></Form></details>}
				{comment.canEdit && <details><summary>Edit</summary><Form className="comment-inline-form" method="post"><input name="intent" type="hidden" value="update-comment" /><input name="postId" type="hidden" value={postId} /><input name="commentId" type="hidden" value={comment.id} /><label className="sr-only" htmlFor={`edit-${comment.id}`}>Edit comment</label><textarea defaultValue={comment.body ?? ""} id={`edit-${comment.id}`} maxLength={4000} minLength={2} name="body" required rows={3} /><button className="button button--secondary button--compact" disabled={submitting} type="submit">Save comment</button></Form></details>}
				{comment.canDelete && <Form method="post" onSubmit={(event) => { if (!window.confirm("Remove this comment?")) event.preventDefault(); }}><input name="intent" type="hidden" value="archive-comment" /><input name="postId" type="hidden" value={postId} /><input name="commentId" type="hidden" value={comment.id} /><button className="comment-remove-button" disabled={submitting} type="submit">Remove</button></Form>}
			</div>}
			{comment.replies.length > 0 && <div className="comment-replies">{comment.replies.map((child) => <CommentItem comment={child} interactive={interactive} key={child.id} postId={postId} reply submitting={submitting} />)}</div>}
		</article>
	);
}

export function CommentThread({ comments, postId, submitting, interactive }: { comments: CommentRecord[]; postId: string; submitting: boolean; interactive: boolean }) {
	return <div className="comment-thread">{comments.map((comment) => <CommentItem comment={comment} interactive={interactive} key={comment.id} postId={postId} submitting={submitting} />)}</div>;
}
