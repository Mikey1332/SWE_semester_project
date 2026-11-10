ALTER TABLE user_groups
ADD COLUMN is_private boolean NOT NULL DEFAULT false;

-- Groups already created with invitation codes are private.
UPDATE user_groups
SET is_private = true
WHERE EXISTS (
    SELECT 1
    FROM group_invites
    WHERE group_invites.group_id = user_groups.id
);