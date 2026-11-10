package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
)

var (
	ErrNotGroupMember = errors.New("you are not a member of this group")
	ErrNoSuchGroup    = errors.New("group does not exist")
	ErrAlreadyMember  = errors.New("already a member of this group")
	ErrGroupNameTaken = errors.New("a group with that name already exists")
)

type Group struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Members int    `json:"members"`
}

// MyGroups lists the groups the user belongs to, with each group's member count.
func MyGroups(ctx context.Context, db *sql.DB, userID int64) ([]Group, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT g.id, g.name, (SELECT count(*) FROM group_members c WHERE c.group_id = g.id)
		FROM user_groups g JOIN group_members m ON m.group_id = g.id
		WHERE m.user_id = $1
		ORDER BY g.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []Group{}
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.Members); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

func CreateGroup(ctx context.Context, db *sql.DB, userID int64, name string, isPrivate bool) (int64, string, error) {
	var code string

	// Only private groups need invitation codes.
	if isPrivate {
		var err error
		code, err = generateInviteCode()
		if err != nil {
			return 0, "", err
		}
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback()

	// Create the group with its owner and privacy setting.
	var groupID int64

	query := "INSERT INTO user_groups (name, owner_id, is_private) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING RETURNING id"
	err = tx.QueryRowContext(ctx, query, name, userID, isPrivate).Scan(&groupID)

	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", ErrGroupNameTaken
	}
	if err != nil {
		return 0, "", err
	}

	// Add the creator as a member.
	query = "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)"
	_, err = tx.ExecContext(ctx, query, groupID, userID)
	if err != nil {
		return 0, "", err
	}

	// Save an invitation code for private groups.
	if isPrivate {
		query = "INSERT INTO group_invites (code, group_id) VALUES ($1, $2)"
		_, err = tx.ExecContext(ctx, query, code, groupID)
		if err != nil {
			return 0, "", err
		}
	}

	err = tx.Commit()
	if err != nil {
		return 0, "", err
	}

	return groupID, code, nil
}

func JoinGroup(ctx context.Context, db *sql.DB, userID, groupID int64) error {
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM user_groups WHERE id = $1)`, groupID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNoSuchGroup
	}
	res, err := db.ExecContext(ctx,
		`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, groupID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrAlreadyMember
	}
	return nil
}

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

func generateInviteCode() (string, error) {
	code := make([]byte, 16)

	_, err := rand.Read(code)
	if err != nil {
		return "", err
	}

	return hex.EncodeToString(code), nil
}
