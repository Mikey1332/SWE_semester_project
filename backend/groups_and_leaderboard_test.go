package main

import (
	"context"
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
