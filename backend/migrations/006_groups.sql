-- Friend groups with their own leaderboard.
CREATE TABLE user_groups (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
    group_id  bigint NOT NULL REFERENCES user_groups (id),
    user_id   bigint NOT NULL REFERENCES users (id),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);
