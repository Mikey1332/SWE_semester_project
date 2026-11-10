package main

import (
	"context"
	"database/sql"
	"errors"
)

var ErrNotGroupMember = errors.New("you are not a member of this group")

func LeaveGroup(ctx context.Context, db *sql.DB, userID, groupID int64) error {
	result, err := db.ExecContext(ctx,
		"DELETE FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, userID,
	)
	if err != nil {
		return err
	}

	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if deleted == 0 {
		return ErrNotGroupMember
	}

	return nil
}
