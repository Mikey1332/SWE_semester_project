package main

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestLeaveGroup(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	unique := fmt.Sprintf("%d", time.Now().UnixNano())

	userID, err := UserForFirebase(ctx, db, "leave-test-"+unique, unique+"@example.com")
	if err != nil {
		t.Fatal(err)
	}

	groupID, err := CreateGroup(ctx, db, "Leave test "+unique)
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
