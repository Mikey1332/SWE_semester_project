package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func mustCreateGroup(t *testing.T, db *sql.DB, ownerID int64, name string, isPrivate bool) (int64, string) {
	t.Helper()
	id, code, err := CreateGroup(context.Background(), db, ownerID, name, isPrivate)
	if err != nil {
		t.Fatal(err)
	}
	return id, code
}

func mustJoinGroup(t *testing.T, db *sql.DB, userID, groupID int64, code string) {
	t.Helper()
	if err := JoinGroup(context.Background(), db, userID, groupID, code); err != nil {
		t.Fatal(err)
	}
}

func assertGroupMember(t *testing.T, db *sql.DB, groupID, userID int64, want bool) {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2`, groupID, userID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if (count == 1) != want {
		t.Fatalf("group %d membership for user %d: count=%d, want member=%v", groupID, userID, count, want)
	}
}

func assertGroupOwner(t *testing.T, db *sql.DB, groupID, wantOwnerID int64) {
	t.Helper()
	var ownerID int64
	if err := db.QueryRow(`SELECT owner_id FROM user_groups WHERE id = $1`, groupID).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	if ownerID != wantOwnerID {
		t.Fatalf("group %d owner=%d, want %d", groupID, ownerID, wantOwnerID)
	}
}

func assertGroupCounts(t *testing.T, db *sql.DB, groupID int64, wantGroups, wantMembers, wantInvites int) {
	t.Helper()
	var groups, members, invites int
	err := db.QueryRow(`
		SELECT (SELECT COUNT(*) FROM user_groups WHERE id = $1),
		       (SELECT COUNT(*) FROM group_members WHERE group_id = $1),
		       (SELECT COUNT(*) FROM group_invites WHERE group_id = $1)`, groupID).Scan(&groups, &members, &invites)
	if err != nil {
		t.Fatal(err)
	}
	if groups != wantGroups || members != wantMembers || invites != wantInvites {
		t.Fatalf("group %d counts=(%d,%d,%d), want (%d,%d,%d)", groupID, groups, members, invites, wantGroups, wantMembers, wantInvites)
	}
}

func signOutForTest(t *testing.T) {
	t.Helper()
	prev := currentUser
	currentUser = func(*http.Request) (int64, error) { return 0, errNotSignedIn }
	t.Cleanup(func() { currentUser = prev })
}

func doReq(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(method, path, r))
	return res
}

func TestT19T20GroupsAndGroupLeaderboard(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	member, newcomer, outsider := newUser(t, db), newUser(t, db), newUser(t, db)
	name := unique("group")
	group, _ := mustCreateGroup(t, db, member, name, false)

	if _, _, err := CreateGroup(ctx, db, member, name, false); !errors.Is(err, ErrGroupNameTaken) {
		t.Fatalf("duplicate name: got %v, want ErrGroupNameTaken", err)
	}
	if err := JoinGroup(ctx, db, member, group, ""); !errors.Is(err, ErrAlreadyMember) {
		t.Fatalf("joining twice: got %v, want ErrAlreadyMember", err)
	}
	if err := JoinGroup(ctx, db, member, -1, ""); !errors.Is(err, ErrNoSuchGroup) {
		t.Fatalf("missing group: got %v, want ErrNoSuchGroup", err)
	}

	m := resolvedMarket(t, db, 1)
	earn(t, db, member, m, 250)
	earn(t, db, outsider, m, 900)

	board, err := Leaderboard(ctx, db, "week", &group)
	if err != nil {
		t.Fatal(err)
	}
	if len(board) != 1 || board[0].UserID != member || board[0].PnL != 250 || board[0].Rank != 1 {
		t.Fatalf("group leaderboard = %+v, want only member ranked 1 with +250", board)
	}

	mustJoinGroup(t, db, newcomer, group, "")
	board, err = Leaderboard(ctx, db, "week", &group)
	if err != nil {
		t.Fatal(err)
	}
	if len(board) != 2 || board[0].UserID != member || board[1].UserID != newcomer || board[1].PnL != 0 || board[1].Rank != 2 {
		t.Fatalf("group leaderboard = %+v, want member 1st and newcomer 2nd with 0", board)
	}
	if groups, err := MyGroups(ctx, db, newcomer); err != nil || len(groups) != 1 || groups[0].Members != 2 {
		t.Fatalf("MyGroups = %+v, %v; want 1 group with 2 members", groups, err)
	}
}

func TestGroupCreationAndInvites(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner, user := newUser(t, db), newUser(t, db)

	pubID, pubCode := mustCreateGroup(t, db, owner, unique("public"), false)
	if pubCode != "" {
		t.Fatal("public group should not return an invite code")
	}
	assertGroupOwner(t, db, pubID, owner)
	assertGroupCounts(t, db, pubID, 1, 1, 0)

	privID, code := mustCreateGroup(t, db, owner, unique("private"), true)
	decoded, err := hex.DecodeString(code)
	if len(code) != 32 || err != nil || len(decoded) != 16 {
		t.Fatalf("invite code %q should be 32 hex chars (16 bytes)", code)
	}
	assertGroupOwner(t, db, privID, owner)
	assertGroupCounts(t, db, privID, 1, 1, 1)
	var savedCode string
	if err := db.QueryRow(`SELECT code FROM group_invites WHERE group_id = $1`, privID).Scan(&savedCode); err != nil || savedCode != code {
		t.Fatalf("saved invite code = %q (%v), want %q", savedCode, err, code)
	}

	if err := JoinGroup(ctx, db, user, privID, ""); !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("missing invite: got %v, want ErrInviteRequired", err)
	}
	if err := JoinGroup(ctx, db, user, privID, "invalid-code"); !errors.Is(err, ErrInvalidInvite) {
		t.Fatalf("invalid invite: got %v, want ErrInvalidInvite", err)
	}
	assertGroupMember(t, db, privID, user, false)

	mustJoinGroup(t, db, user, privID, code)
	assertGroupMember(t, db, privID, user, true)
	if err := JoinGroup(ctx, db, user, privID, code); !errors.Is(err, ErrAlreadyMember) {
		t.Fatalf("duplicate invite join: got %v, want ErrAlreadyMember", err)
	}
}

func TestGroupLeaveAndRemoval(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner, member, other := newUser(t, db), newUser(t, db), newUser(t, db)
	groupID, _ := mustCreateGroup(t, db, owner, unique("members"), false)
	mustJoinGroup(t, db, member, groupID, "")
	mustJoinGroup(t, db, other, groupID, "")

	if err := LeaveGroup(ctx, db, owner, groupID); !errors.Is(err, ErrGroupOwnerCannotLeave) {
		t.Fatalf("owner leave: got %v, want ErrGroupOwnerCannotLeave", err)
	}
	assertGroupMember(t, db, groupID, owner, true)

	if err := LeaveGroup(ctx, db, member, groupID); err != nil {
		t.Fatal(err)
	}
	assertGroupMember(t, db, groupID, member, false)
	if err := LeaveGroup(ctx, db, member, groupID); !errors.Is(err, ErrNotGroupMember) {
		t.Fatalf("leave twice: got %v, want ErrNotGroupMember", err)
	}

	mustJoinGroup(t, db, member, groupID, "")
	if err := RemoveGroupMember(ctx, db, member, groupID, other); !errors.Is(err, ErrNotGroupOwner) {
		t.Fatalf("member remove: got %v, want ErrNotGroupOwner", err)
	}
	if err := RemoveGroupMember(ctx, db, owner, groupID, owner); !errors.Is(err, ErrCannotRemoveOwner) {
		t.Fatalf("owner self-remove: got %v, want ErrCannotRemoveOwner", err)
	}
	assertGroupMember(t, db, groupID, other, true)
	assertGroupMember(t, db, groupID, owner, true)

	if err := RemoveGroupMember(ctx, db, owner, groupID, other); err != nil {
		t.Fatal(err)
	}
	assertGroupMember(t, db, groupID, other, false)

	handler := routes(db)
	path := fmt.Sprintf("/groups/%d/members/%d/remove", groupID, member)

	signInAs(t, member)
	if res := doReq(handler, http.MethodPost, path, ""); res.Code != http.StatusForbidden {
		t.Fatalf("regular member remove API: got %d, want 403", res.Code)
	}
	assertGroupMember(t, db, groupID, member, true)

	signInAs(t, owner)
	if res := doReq(handler, http.MethodPost, path, ""); res.Code != http.StatusNoContent {
		t.Fatalf("owner remove API: got %d (%s), want 204", res.Code, res.Body.String())
	}
	assertGroupMember(t, db, groupID, member, false)
}

func TestGroupMembersAndPrivateAccess(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner, member, outsider := newUser(t, db), newUser(t, db), newUser(t, db)

	privID, code := mustCreateGroup(t, db, owner, unique("private-access"), true)
	mustJoinGroup(t, db, member, privID, code)
	pubID, _ := mustCreateGroup(t, db, owner, unique("public-access"), false)

	members, err := GetGroupMembers(ctx, db, member, privID)
	if err != nil || len(members) != 2 {
		t.Fatalf("private members = %+v (%v), want 2", members, err)
	}
	seen := map[int64]bool{}
	for _, m := range members {
		seen[m.UserID] = m.IsOwner
	}
	if !seen[owner] || seen[member] || len(seen) != 2 {
		t.Fatalf("unexpected member owner flags: %+v", members)
	}

	if got, err := GetGroupMembers(ctx, db, outsider, privID); !errors.Is(err, ErrPrivateGroupAccess) || len(got) != 0 {
		t.Fatalf("outsider private members = %+v, %v; want ErrPrivateGroupAccess", got, err)
	}
	if got, err := GetGroupMembers(ctx, db, outsider, pubID); err != nil || len(got) != 1 || got[0].UserID != owner || !got[0].IsOwner {
		t.Fatalf("outsider public members = %+v, %v; want owner only", got, err)
	}

	handler := routes(db)
	membersPath := fmt.Sprintf("/groups/%d/members", privID)
	boardPath := fmt.Sprintf("/groups/%d/leaderboard", privID)

	signOutForTest(t)
	if res := doReq(handler, http.MethodGet, membersPath, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("signed-out members API: got %d, want 401", res.Code)
	}

	signInAs(t, outsider)
	if res := doReq(handler, http.MethodGet, membersPath, ""); res.Code != http.StatusForbidden {
		t.Fatalf("outsider members API: got %d, want 403", res.Code)
	}
	if res := doReq(handler, http.MethodGet, boardPath, ""); res.Code != http.StatusForbidden {
		t.Fatalf("outsider board API: got %d, want 403", res.Code)
	}

	signInAs(t, owner)
	res := doReq(handler, http.MethodGet, membersPath, "")
	if res.Code != http.StatusOK {
		t.Fatalf("owner members API: got %d (%s), want 200", res.Code, res.Body.String())
	}
	var got []GroupMember
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil || len(got) != 2 {
		t.Fatalf("owner members payload = %s (%v), want 2 members", res.Body.String(), err)
	}
	if res := doReq(handler, http.MethodGet, boardPath, ""); res.Code != http.StatusOK {
		t.Fatalf("owner board API: got %d (%s), want 200", res.Code, res.Body.String())
	}
}

func TestGroupOwnershipTransfer(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner, member, outsider := newUser(t, db), newUser(t, db), newUser(t, db)
	groupID, _ := mustCreateGroup(t, db, owner, unique("transfer"), false)
	mustJoinGroup(t, db, member, groupID, "")

	for _, tc := range []struct {
		actor, target int64
		want          error
	}{
		{member, member, ErrNotGroupOwner},
		{owner, outsider, ErrNotGroupMember},
		{owner, owner, ErrAlreadyGroupOwner},
	} {
		if err := TransferGroupOwnership(ctx, db, tc.actor, groupID, tc.target); !errors.Is(err, tc.want) {
			t.Fatalf("transfer(%d -> %d): got %v, want %v", tc.actor, tc.target, err, tc.want)
		}
	}
	assertGroupOwner(t, db, groupID, owner)

	handler := routes(db)
	path := fmt.Sprintf("/groups/%d/owner", groupID)
	body := fmt.Sprintf(`{"user_id":%d}`, member)

	signInAs(t, member)
	if res := doReq(handler, http.MethodPost, path, body); res.Code != http.StatusForbidden {
		t.Fatalf("member transfer API: got %d, want 403", res.Code)
	}
	assertGroupOwner(t, db, groupID, owner)

	signInAs(t, owner)
	if res := doReq(handler, http.MethodPost, path, body); res.Code != http.StatusNoContent {
		t.Fatalf("owner transfer API: got %d (%s), want 204", res.Code, res.Body.String())
	}
	assertGroupOwner(t, db, groupID, member)

	if err := LeaveGroup(ctx, db, owner, groupID); err != nil {
		t.Fatalf("former owner leave: %v", err)
	}
	if err := LeaveGroup(ctx, db, member, groupID); !errors.Is(err, ErrGroupOwnerCannotLeave) {
		t.Fatalf("new owner leave: got %v, want ErrGroupOwnerCannotLeave", err)
	}
}

func TestGroupDeletion(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner, member := newUser(t, db), newUser(t, db)
	groupID, code := mustCreateGroup(t, db, owner, unique("delete"), true)
	mustJoinGroup(t, db, member, groupID, code)

	if err := DeleteGroup(ctx, db, member, groupID); !errors.Is(err, ErrNotGroupOwner) {
		t.Fatalf("member delete: got %v, want ErrNotGroupOwner", err)
	}
	assertGroupCounts(t, db, groupID, 1, 2, 1)

	handler := routes(db)
	path := fmt.Sprintf("/groups/%d", groupID)

	signOutForTest(t)
	if res := doReq(handler, http.MethodDelete, path, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("signed-out delete API: got %d, want 401", res.Code)
	}
	signInAs(t, member)
	if res := doReq(handler, http.MethodDelete, path, ""); res.Code != http.StatusForbidden {
		t.Fatalf("member delete API: got %d, want 403", res.Code)
	}
	assertGroupCounts(t, db, groupID, 1, 2, 1)

	signInAs(t, owner)
	if res := doReq(handler, http.MethodDelete, path, ""); res.Code != http.StatusNoContent {
		t.Fatalf("owner delete API: got %d (%s), want 204", res.Code, res.Body.String())
	}
	assertGroupCounts(t, db, groupID, 0, 0, 0)

	var users int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE id IN ($1, $2)`, owner, member).Scan(&users); err != nil || users != 2 {
		t.Fatalf("users after delete = %d (%v), want 2", users, err)
	}
	if err := DeleteGroup(ctx, db, owner, groupID); !errors.Is(err, ErrNoSuchGroup) {
		t.Fatalf("delete again: got %v, want ErrNoSuchGroup", err)
	}
}

func TestSearchAndPublicGroupsAPI(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner := newUser(t, db)
	search := unique("search")

	pubID, _ := mustCreateGroup(t, db, owner, search+" Music Fans", false)
	mustCreateGroup(t, db, owner, search+" Private Fans", true)
	mustCreateGroup(t, db, owner, unique("unrelated"), false)

	groups, err := GetPublicGroups(ctx, db, strings.ToUpper(search))
	if err != nil || len(groups) != 1 || groups[0].ID != pubID || groups[0].Members != 1 {
		t.Fatalf("GetPublicGroups = %+v (%v), want 1 public group %d with 1 member", groups, err, pubID)
	}

	handler := routes(db)
	path := "/groups?search=" + search

	signOutForTest(t)
	if res := doReq(handler, http.MethodGet, path, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("signed-out public groups API: got %d, want 401", res.Code)
	}

	signInAs(t, owner)
	res := doReq(handler, http.MethodGet, path, "")
	if res.Code != http.StatusOK {
		t.Fatalf("public groups API: got %d (%s), want 200", res.Code, res.Body.String())
	}
	var got []Group
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil || len(got) != 1 || got[0].ID != pubID {
		t.Fatalf("public groups payload = %s (%v), want group %d", res.Body.String(), err, pubID)
	}
}
