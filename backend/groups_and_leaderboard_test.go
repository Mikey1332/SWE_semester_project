package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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

	err = JoinGroup(ctx, db, userID, groupID, "")
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
	if err := JoinGroup(ctx, db, member, group, ""); !errors.Is(err, ErrAlreadyMember) {
		t.Fatalf("joining twice: got %v, want ErrAlreadyMember", err)
	}
	if err := JoinGroup(ctx, db, member, -1, ""); !errors.Is(err, ErrNoSuchGroup) {
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

	if err := JoinGroup(ctx, db, newcomer, group, ""); err != nil {
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

// US9: a private group cannot be joined using only its group ID.
func TestPrivateGroupRequiresInvite(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	ownerID := newUser(t, db)
	userID := newUser(t, db)

	groupID, _, err := CreateGroup(ctx, db, ownerID, unique("private"), true)
	if err != nil {
		t.Fatal(err)
	}

	err = JoinGroup(ctx, db, userID, groupID, "")
	if !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("expected ErrInviteRequired, got %v", err)
	}

	// Check the rejected user was not added.
	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, userID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 0 {
		t.Fatal("user should not have joined the private group")
	}
}

// US9: a user can join a private group with a valid invite code.
func TestJoinGroupByInvite(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	ownerID := newUser(t, db)
	userID := newUser(t, db)

	groupID, code, err := CreateGroup(ctx, db, ownerID, unique("private"), true)
	if err != nil {
		t.Fatal(err)
	}

	err = JoinGroup(ctx, db, userID, groupID, code)
	if err != nil {
		t.Fatal(err)
	}

	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, userID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Fatal("user should be a member of the group")
	}

	// Using the invitation again must not add a duplicate membership.
	err = JoinGroup(ctx, db, userID, groupID, code)
	if !errors.Is(err, ErrAlreadyMember) {
		t.Fatalf("expected ErrAlreadyMember, got %v", err)
	}
}

// US9: an invalid invite code does not add the user to any group.
func TestInvalidGroupInvite(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	userID := newUser(t, db)

	ownerID := newUser(t, db)
	groupID, _, err := CreateGroup(ctx, db, ownerID, unique("private"), true)
	if err != nil {
		t.Fatal(err)
	}

	err = JoinGroup(ctx, db, userID, groupID, "invalid-code")
	if !errors.Is(err, ErrInvalidInvite) {
		t.Fatalf("expected ErrInvalidInvite, got %v", err)
	}

	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE user_id = $1",
		userID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 0 {
		t.Fatal("invalid invite should not create a membership")
	}
}

// US9: the owner cannot leave and abandon their group.
func TestGroupOwnerCannotLeave(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	ownerID := newUser(t, db)

	groupID, _, err := CreateGroup(ctx, db, ownerID, unique("owner"), false)
	if err != nil {
		t.Fatal(err)
	}

	err = LeaveGroup(ctx, db, ownerID, groupID)
	if !errors.Is(err, ErrGroupOwnerCannotLeave) {
		t.Fatalf("expected ErrGroupOwnerCannotLeave, got %v", err)
	}

	// The rejected action must leave the owner's membership intact.
	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, ownerID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Fatal("owner should still be a member")
	}
}

// US9: the group owner can remove a member.
func TestOwnerCanRemoveGroupMember(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	ownerID := newUser(t, db)
	memberID := newUser(t, db)

	groupID, _, err := CreateGroup(ctx, db, ownerID, unique("remove"), false)
	if err != nil {
		t.Fatal(err)
	}

	err = JoinGroup(ctx, db, memberID, groupID, "")
	if err != nil {
		t.Fatal(err)
	}

	err = RemoveGroupMember(ctx, db, ownerID, groupID, memberID)
	if err != nil {
		t.Fatal(err)
	}

	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, memberID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 0 {
		t.Fatal("member should have been removed")
	}
}

// US9: a regular member cannot remove another member.
func TestMemberCannotRemoveGroupMember(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	ownerID := newUser(t, db)
	memberID := newUser(t, db)
	otherMemberID := newUser(t, db)

	groupID, _, err := CreateGroup(ctx, db, ownerID, unique("permissions"), false)
	if err != nil {
		t.Fatal(err)
	}

	err = JoinGroup(ctx, db, memberID, groupID, "")
	if err != nil {
		t.Fatal(err)
	}

	err = JoinGroup(ctx, db, otherMemberID, groupID, "")
	if err != nil {
		t.Fatal(err)
	}

	err = RemoveGroupMember(ctx, db, memberID, groupID, otherMemberID)
	if !errors.Is(err, ErrNotGroupOwner) {
		t.Fatalf("expected ErrNotGroupOwner, got %v", err)
	}

	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, otherMemberID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Fatal("member should still belong to the group")
	}
}

// US9: the owner cannot remove their own membership.
func TestOwnerCannotRemoveThemselves(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	ownerID := newUser(t, db)

	groupID, _, err := CreateGroup(ctx, db, ownerID, unique("owner"), false)
	if err != nil {
		t.Fatal(err)
	}

	err = RemoveGroupMember(ctx, db, ownerID, groupID, ownerID)
	if !errors.Is(err, ErrCannotRemoveOwner) {
		t.Fatalf("expected ErrCannotRemoveOwner, got %v", err)
	}

	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, ownerID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Fatal("owner should still belong to the group")
	}
}

// US9: the removal API rejects regular members and allows the owner.
func TestRemoveGroupMemberAPI(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	ownerID := newUser(t, db)
	memberID := newUser(t, db)

	groupID, _, err := CreateGroup(ctx, db, ownerID, unique("remove-api"), false)
	if err != nil {
		t.Fatal(err)
	}

	err = JoinGroup(ctx, db, memberID, groupID, "")
	if err != nil {
		t.Fatal(err)
	}

	// Restore normal authentication after this test.
	originalCurrentUser := currentUser
	t.Cleanup(func() {
		currentUser = originalCurrentUser
	})

	path := fmt.Sprintf("/groups/%d/members/%d/remove", groupID, memberID)
	handler := routes(db)

	// Simulate a request from a regular member.
	currentUser = func(r *http.Request) (int64, error) {
		return memberID, nil
	}

	request := httptest.NewRequest(http.MethodPost, path, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for regular member, got %d", response.Code)
	}

	// Confirm the rejected request did not remove the member.
	var count int
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, memberID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Fatal("rejected request should not remove the member")
	}

	// Simulate a request from the owner.
	currentUser = func(r *http.Request) (int64, error) {
		return ownerID, nil
	}

	request = httptest.NewRequest(http.MethodPost, path, nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for owner, got %d: %s", response.Code, response.Body.String())
	}

	// Confirm the successful request removed the member.
	err = db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2",
		groupID, memberID,
	).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}

	if count != 0 {
		t.Fatal("owner's request should remove the member")
	}
}
