-- Record who manages each group.
ALTER TABLE user_groups
ADD COLUMN owner_id bigint REFERENCES users (id);

-- For existing groups, make the first (or earliest) member the owner
-- The original creator was not recorded
UPDATE user_groups
SET owner_id = (
    SELECT user_id
    FROM group_members
    WHERE group_id = user_groups.id
    ORDER BY joined_at, user_id
    LIMIT 1
);

-- Empty existing groups keep a NULL owner until handled by the application.

-- Stores private invitation codes
CREATE TABLE group_invites (
    code       text PRIMARY KEY,
    group_id   bigint NOT NULL REFERENCES user_groups (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);