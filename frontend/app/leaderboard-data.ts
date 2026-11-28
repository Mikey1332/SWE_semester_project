export type LeaderboardEntry = {
  rank: number;
  user_id: number;
  name: string;
  pnl: number;
};

type SignedInUser = { getIdToken: () => Promise<string> };

// Firebase authenticates users; /auth/me creates their PostgreSQL trading
// profile. Finish that synchronization before querying the rankings.
export async function loadLeaderboard(
  user: SignedInUser | null,
  signal?: AbortSignal,
) {
  let currentUserId: number | null = null;
  if (user) {
    const token = await user.getIdToken();
    const response = await fetch("/api/auth/me", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "Your Firebase session could not be verified. Please log out and sign in again.",
        );
      }
      if (response.status === 503) {
        throw new Error(
          "Your profile could not sync right now. Try Refresh charts.",
        );
      }
      throw new Error(
        "Your signed-in profile could not sync with the backend. Please try Refresh charts.",
      );
    }
    currentUserId = (await response.json()).user_id as number;
  }
  const response = await fetch("/api/leaderboard/profiles", {
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(
      "Could not load the charts. Check that the backend is running, then try Refresh charts.",
    );
  const entries = (await response.json()) as LeaderboardEntry[];
  return { entries: entries.slice(0, 10), currentUserId };
}
