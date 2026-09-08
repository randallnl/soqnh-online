CREATE TABLE `post_affiliations` (
	`post_id` text NOT NULL,
	`affiliation_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`post_id`, `affiliation_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`affiliation_id`) REFERENCES `affiliations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_post_affiliations_affiliation_id` ON `post_affiliations` (`affiliation_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `post_affiliations` (`post_id`, `affiliation_id`)
SELECT p.id, oa.affiliation_id
FROM posts AS p
JOIN organization_affiliations AS oa ON oa.organization_id = p.organization_id
WHERE p.visibility = 'members';
--> statement-breakpoint
INSERT OR IGNORE INTO `post_affiliations` (`post_id`, `affiliation_id`)
SELECT p.id, a.id
FROM posts AS p
CROSS JOIN affiliations AS a
WHERE p.visibility = 'members' AND p.organization_id IS NULL;
