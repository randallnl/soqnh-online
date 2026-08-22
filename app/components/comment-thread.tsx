import { Form, Link } from "react-router";

import { Icon } from "~/components/icon";
import { IdentityAvatar } from "~/components/identity-avatar";
import type { CommentRecord } from "~/models/comments.server";
import type { MentionableMember } from "~/models/interactions.server";

function formatCommentDate(value: string) {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function MentionSelect({ members }: { members: MentionableMember[] }) {
	return <label className="comment-mention-field">Notify a member<select name="mentionUserId"><option value="">No mention</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name || "Member"}{member.profileTitle ? ` · ${member.profileTitle}` : member.organizationNames ? ` · ${member.organizationNames}` : ""}</option>)}</select></label>;
}

function CommentItem({ comment, postId, submitting, interactive, mentionableMembers, visibleMemberIds, reply = false }: { comment: CommentRecord; postId: string; submitting: boolean; interactive: boolean; mentionableMembers: MentionableMember[]; visibleMemberIds: string[]; reply?: boolean }) {
	const edited = comment.updatedAt !== comment.createdAt && comment.status === "published";
	return (
		<article className={`comment-card${reply ? " comment-card--reply" : ""}`} id={`comment-${comment.id}`}>
			<div className="comment-card-meta"><IdentityAvatar name={comment.authorName || "Member"} objectKey={comment.authorAvatarObjectKey} /><div>{visibleMemberIds.includes(comment.authorUserId) ? <Link className="identity-name-link" to={`/members/${comment.authorUserId}`}><strong>{comment.authorName || "Member"}</strong></Link> : <strong>{comment.authorName || "Member"}</strong>}<p>{formatCommentDate(comment.createdAt)}{edited ? " · edited" : ""}</p></div></div>
			{comment.status === "archived" ? <p className="comment-tombstone">This comment was removed.</p> : <div className="comment-body">{comment.body?.split(/\n{2,}/).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>)}</div>}
			{comment.mentionedUserName && <p className="comment-mention-label"><Icon name="user" size={13} /> Mentioned {comment.mentionedUserName}</p>}
			{interactive && comment.status === "published" && <div className="comment-actions">
				{!reply && <details><summary>Reply</summary><Form className="comment-inline-form" method="post"><input name="intent" type="hidden" value="create-comment" /><input name="postId" type="hidden" value={postId} /><input name="parentCommentId" type="hidden" value={comment.id} /><label className="sr-only" htmlFor={`reply-${comment.id}`}>Reply to {comment.authorName || "comment"}</label><textarea id={`reply-${comment.id}`} maxLength={4000} minLength={2} name="body" placeholder="Write a reply…" required rows={3} /><MentionSelect members={mentionableMembers} /><button className="button button--primary button--compact" disabled={submitting} type="submit">Post reply</button></Form></details>}
				{comment.canEdit && <details><summary>Edit</summary><Form className="comment-inline-form" method="post"><input name="intent" type="hidden" value="update-comment" /><input name="postId" type="hidden" value={postId} /><input name="commentId" type="hidden" value={comment.id} /><label className="sr-only" htmlFor={`edit-${comment.id}`}>Edit comment</label><textarea defaultValue={comment.body ?? ""} id={`edit-${comment.id}`} maxLength={4000} minLength={2} name="body" required rows={3} /><button className="button button--secondary button--compact" disabled={submitting} type="submit">Save comment</button></Form></details>}
				{comment.canDelete && <Form method="post" onSubmit={(event) => { if (!window.confirm("Remove this comment?")) event.preventDefault(); }}><input name="intent" type="hidden" value="archive-comment" /><input name="postId" type="hidden" value={postId} /><input name="commentId" type="hidden" value={comment.id} /><button className="comment-remove-button" disabled={submitting} type="submit">Remove</button></Form>}
			</div>}
			{comment.replies.length > 0 && <div className="comment-replies">{comment.replies.map((child) => <CommentItem comment={child} interactive={interactive} key={child.id} mentionableMembers={mentionableMembers} postId={postId} reply submitting={submitting} visibleMemberIds={visibleMemberIds} />)}</div>}
		</article>
	);
}

export function CommentThread({ comments, postId, submitting, interactive, mentionableMembers, visibleMemberIds }: { comments: CommentRecord[]; postId: string; submitting: boolean; interactive: boolean; mentionableMembers: MentionableMember[]; visibleMemberIds: string[] }) {
	return <div className="comment-thread">{comments.map((comment) => <CommentItem comment={comment} interactive={interactive} key={comment.id} mentionableMembers={mentionableMembers} postId={postId} submitting={submitting} visibleMemberIds={visibleMemberIds} />)}</div>;
}
