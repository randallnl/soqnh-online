DELETE FROM `post_affiliations`
WHERE `post_id` IN (
	SELECT `id`
	FROM `posts`
	WHERE `section` = 'event'
	  AND `author_user_id` = 'system:event-scraper'
);
