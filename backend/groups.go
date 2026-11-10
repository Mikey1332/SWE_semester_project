package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
)

var (
	ErrNotGroupMember        = errors.New("you are not a member of this group")
	ErrNoSuchGroup           = errors.New("group does not exist")
	ErrAlreadyMember         = errors.New("already a member of this group")
	ErrGroupNameTaken        = errors.New("a group with that name already exists")
	ErrInviteRequired        = errors.New("an invite code is required to join this group")
	ErrInvalidInvite         = errors.New("invalid invite code")
	ErrGroupOwnerCannotLeave = errors.New("transfer ownership or delete the group before leaving")
	ErrNotGroupOwner         = errors.New("group owner permissions required")
	ErrCannotRemoveOwner     = errors.New("the group owner cannot be removed")
	ErrPrivateGroupAccess    = errors.New("group membership required")
	ErrAlreadyGroupOwner     = errors.New("this user already owns the group")
)

type Group struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Members int    `json:"members"`
}

type GroupMember struct {
	UserID  int64  `json:"user_id"`
	Name    string `json:"name"`
	IsOwner bool   `json:"is_owner"`
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

func JoinGroup(ctx context.Context, db *sql.DB, userID, groupID int64, code string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Check whether the group exists and is private.
	var isPrivate bool

	query := "SELECT is_private FROM user_groups WHERE id = $1 FOR SHARE"
	err = tx.QueryRowContext(ctx, query, groupID).Scan(&isPrivate)

	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoSuchGroup
	}
	if err != nil {
		return err
	}

	// Private groups require an invitation for this specific group.
	if isPrivate {
		if code == "" {
			return ErrInviteRequired
		}

		var savedCode string

		query = "SELECT code FROM group_invites WHERE group_id = $1 AND code = $2 FOR SHARE"
		err = tx.QueryRowContext(ctx, query, groupID, code).Scan(&savedCode)

		if errors.Is(err, sql.ErrNoRows) {
			return ErrInvalidInvite
		}
		if err != nil {
			return err
		}
	}

	// Add the user unless they already belong to the group.
	query = "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
	result, err := tx.ExecContext(ctx, query, groupID, userID)
	if err != nil {
		return err
	}

	added, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if added == 0 {
		return ErrAlreadyMember
	}

	return tx.Commit()
}

func LeaveGroup(ctx context.Context, db *sql.DB, userID, groupID int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock the group while checking ownership and removing membership.
	var ownerID sql.NullInt64

	query := "SELECT owner_id FROM user_groups WHERE id = $1 FOR UPDATE"
	err = tx.QueryRowContext(ctx, query, groupID).Scan(&ownerID)

	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoSuchGroup
	}
	if err != nil {
		return err
	}

	if ownerID.Valid && ownerID.Int64 == userID {
		return ErrGroupOwnerCannotLeave
	}

	query = "DELETE FROM group_members WHERE group_id = $1 AND user_id = $2"
	result, err := tx.ExecContext(ctx, query, groupID, userID)
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

	return tx.Commit()
}

func generateInviteCode() (string, error) {
	code := make([]byte, 16)

	_, err := rand.Read(code)
	if err != nil {
		return "", err
	}

	return hex.EncodeToString(code), nil
}

func RemoveGroupMember(ctx context.Context, db *sql.DB, userID, groupID, memberID int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock the group so ownership cannot change during removal.
	var ownerID sql.NullInt64

	query := "SELECT owner_id FROM user_groups WHERE id = $1 FOR UPDATE"
	err = tx.QueryRowContext(ctx, query, groupID).Scan(&ownerID)

	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoSuchGroup
	}
	if err != nil {
		return err
	}

	if !ownerID.Valid || ownerID.Int64 != userID {
		return ErrNotGroupOwner
	}

	if memberID == ownerID.Int64 {
		return ErrCannotRemoveOwner
	}

	query = "DELETE FROM group_members WHERE group_id = $1 AND user_id = $2"
	result, err := tx.ExecContext(ctx, query, groupID, memberID)
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

	return tx.Commit()
}

func GetGroupMembers(ctx context.Context, db *sql.DB, userID, groupID int64) ([]GroupMember, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var isPrivate bool

	query := "SELECT is_private FROM user_groups WHERE id = $1 FOR SHARE"
	err = tx.QueryRowContext(ctx, query, groupID).Scan(&isPrivate)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoSuchGroup
	}
	if err != nil {
		return nil, err
	}

	// Only members can view a private group's members.
	if isPrivate {
		var isMember bool

		query = "SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)"
		err = tx.QueryRowContext(ctx, query, groupID, userID).Scan(&isMember)
		if err != nil {
			return nil, err
		}

		if !isMember {
			return nil, ErrPrivateGroupAccess
		}
	}

	query = "SELECT u.id, COALESCE(NULLIF(u.username, ''), 'Player ' || u.id), COALESCE(u.id = g.owner_id, false) FROM group_members m JOIN users u ON u.id = m.user_id JOIN user_groups g ON g.id = m.group_id WHERE m.group_id = $1 ORDER BY m.joined_at, u.id"
	rows, err := tx.QueryContext(ctx, query, groupID)
	if err != nil {
		return nil, err
	}

	members := []GroupMember{}

	for rows.Next() {
		var member GroupMember

		err = rows.Scan(&member.UserID, &member.Name, &member.IsOwner)
		if err != nil {
			rows.Close()
			return nil, err
		}

		members = append(members, member)
	}

	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}

	err = tx.Commit()
	if err != nil {
		return nil, err
	}

	return members, nil
}

func TransferGroupOwnership(ctx context.Context, db *sql.DB, userID, groupID, newOwnerID int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock the group while changing ownership.
	var ownerID sql.NullInt64

	query := "SELECT owner_id FROM user_groups WHERE id = $1 FOR UPDATE"
	err = tx.QueryRowContext(ctx, query, groupID).Scan(&ownerID)

	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoSuchGroup
	}
	if err != nil {
		return err
	}

	// Only the current owner can transfer ownership.
	if !ownerID.Valid || ownerID.Int64 != userID {
		return ErrNotGroupOwner
	}

	if newOwnerID == userID {
		return ErrAlreadyGroupOwner
	}

	// The new owner must already belong to the group.
	var isMember bool

	query = "SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)"
	err = tx.QueryRowContext(ctx, query, groupID, newOwnerID).Scan(&isMember)
	if err != nil {
		return err
	}

	if !isMember {
		return ErrNotGroupMember
	}

	query = "UPDATE user_groups SET owner_id = $1 WHERE id = $2"
	_, err = tx.ExecContext(ctx, query, newOwnerID, groupID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func DeleteGroup(ctx context.Context, db *sql.DB, userID, groupID int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock the group while checking ownership and deleting it.
	var ownerID sql.NullInt64

	query := "SELECT owner_id FROM user_groups WHERE id = $1 FOR UPDATE"
	err = tx.QueryRowContext(ctx, query, groupID).Scan(&ownerID)

	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoSuchGroup
	}
	if err != nil {
		return err
	}

	if !ownerID.Valid || ownerID.Int64 != userID {
		return ErrNotGroupOwner
	}

	// Remove memberships before deleting the group.
	query = "DELETE FROM group_members WHERE group_id = $1"
	_, err = tx.ExecContext(ctx, query, groupID)
	if err != nil {
		return err
	}

	// Remove the group's invitation codes.
	query = "DELETE FROM group_invites WHERE group_id = $1"
	_, err = tx.ExecContext(ctx, query, groupID)
	if err != nil {
		return err
	}

	query = "DELETE FROM user_groups WHERE id = $1"
	_, err = tx.ExecContext(ctx, query, groupID)
	if err != nil {
		return err
	}

	return tx.Commit()
}
