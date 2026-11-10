package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"testing"
	"time"
)

// US9: a user can leave a group
func TestLeaveGroup(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	userID, err := UserForFirebase(ctx, db, "leave-test-"+unique, unique+"@example.com")
	if err != nil {
		t.Fatal(err)
	}

	ownerID := newUser(t, db)
	groupID, _, err := CreateGroup(ctx, db, ownerID, "Leave test "+unique, false)
	if err != nil {
		t.Fatal(err)
	}

	err = JoinGroup(ctx, db, userID, groupID)
	if err != nil {
		t.Fatal(err)
	}

	// Leave the group.
	err = LeaveGroup(ctx, db, userID, groupID)
	if err != nil {
		t.Fatal(err)
	}

	// Check the membership was removed.
	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, userID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 0 {
		t.Fatal("user is still in the group")
	}

	// Leaving again should report that the user is not a member.
	err = LeaveGroup(ctx, db, userID, groupID)
	if !errors.Is(err, ErrNotGroupMember) {
		t.Fatalf("expected ErrNotGroupMember, got %v", err)
	}
}

// T19 + T20: a user joins a group once, and the group leaderboard ranks only its members.
func TestT19T20GroupsAndGroupLeaderboard(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	member, outsider := newUser(t, db), newUser(t, db)
	group, _, err := CreateGroup(ctx, db, member, unique("group"), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := JoinGroup(ctx, db, member, group); !errors.Is(err, ErrAlreadyMember) {
		t.Fatalf("joining twice: got %v, want ErrAlreadyMember", err)
	}
	if err := JoinGroup(ctx, db, member, -1); !errors.Is(err, ErrNoSuchGroup) {
		t.Fatalf("missing group: got %v, want ErrNoSuchGroup", err)
	}

	m := resolvedMarket(t, db, 1)
	earn(t, db, member, m, 250)
	earn(t, db, outsider, m, 900) // more P&L, but not in the group

	board, err := Leaderboard(ctx, db, "week", &group) // T20
	if err != nil {
		t.Fatal(err)
	}
	if len(board) != 1 || board[0].UserID != member || board[0].PnL != 250 || board[0].Rank != 1 {
		t.Fatalf("group leaderboard = %+v, want only the member, ranked 1 with +250", board)
	}
}

// US9: a taken group name is refused, and every member is ranked, even one who hasn't traded yet.
func TestGroupCreateAndEveryMemberRanked(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	name := unique("friends")
	trader, newcomer := newUser(t, db), newUser(t, db)

	group, _, err := CreateGroup(ctx, db, trader, name, false)
	if err != nil {
		t.Fatal(err)
	}

	if _, _, err := CreateGroup(ctx, db, trader, name, false); !errors.Is(err, ErrGroupNameTaken) {
		t.Fatalf("duplicate name: got %v, want ErrGroupNameTaken", err)
	}

	if err := JoinGroup(ctx, db, newcomer, group); err != nil {
		t.Fatal(err)
	}
	earn(t, db, trader, resolvedMarket(t, db, 1), 250)

	board, err := Leaderboard(ctx, db, "week", &group)
	if err != nil {
		t.Fatal(err)
	}
	if len(board) != 2 || board[0].UserID != trader || board[1].UserID != newcomer || board[1].PnL != 0 || board[1].Rank != 2 {
		t.Fatalf("group leaderboard = %+v, want trader first and newcomer ranked 2nd with 0", board)
	}
	if groups, err := MyGroups(ctx, db, newcomer); err != nil || len(groups) != 1 || groups[0].Members != 2 {
		t.Fatalf("MyGroups = %+v, %v; want 1 group with 2 members", groups, err)
	}
}

// US9: a public group records its owner and does not create an invite code.
func TestCreatePublicGroup(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	ownerID := newUser(t, db)

	groupID, code, err := CreateGroup(ctx, db, ownerID, unique("public"), false)
	if err != nil {
		t.Fatal(err)
	}

	if code != "" {
		t.Fatal("public group should not return an invite code")
	}

	var savedOwnerID int64
	var isPrivate bool

	err = db.QueryRowContext(ctx,
		"SELECT owner_id, is_private FROM user_groups WHERE id = $1",
		groupID,
	).Scan(&savedOwnerID, &isPrivate)
	if err != nil {
		t.Fatal(err)
	}

	if savedOwnerID != ownerID {
		t.Fatal("incorrect group owner")
	}

	if isPrivate {
		t.Fatal("group should be public")
	}

	var inviteCount int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_invites WHERE group_id = $1",
		groupID,
	).Scan(&inviteCount)
	if err != nil {
		t.Fatal(err)
	}

	if inviteCount != 0 {
		t.Fatal("public group should not have a saved invite code")
	}
}

// US9: a private group records its owner and saves a 32-character invite code.
func TestCreatePrivateGroup(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	ownerID := newUser(t, db)

	groupID, code, err := CreateGroup(ctx, db, ownerID, unique("private"), true)
	if err != nil {
		t.Fatal(err)
	}

	if len(code) != 32 {
		t.Fatal("invite code should contain 32 characters")
	}

	decoded, err := hex.DecodeString(code)
	if err != nil || len(decoded) != 16 {
		t.Fatal("invite code should represent 16 bytes in hexadecimal")
	}

	var savedOwnerID int64
	var isPrivate bool

	err = db.QueryRowContext(ctx,
		"SELECT owner_id, is_private FROM user_groups WHERE id = $1",
		groupID,
	).Scan(&savedOwnerID, &isPrivate)
	if err != nil {
		t.Fatal(err)
	}

	if savedOwnerID != ownerID {
		t.Fatal("incorrect group owner")
	}

	if !isPrivate {
		t.Fatal("group should be private")
	}

	var savedCode string
	err = db.QueryRowContext(ctx,
		"SELECT code FROM group_invites WHERE group_id = $1",
		groupID,
	).Scan(&savedCode)
	if err != nil {
		t.Fatal(err)
	}

	if savedCode != code {
		t.Fatal("saved invite code does not match the returned code")
	}

	var memberCount int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, ownerID,
	).Scan(&memberCount)
	if err != nil {
		t.Fatal(err)
	}

	if memberCount != 1 {
		t.Fatal("owner should be a member of the private group")
	}
}
