import { afterEach, expect, test, vi } from "vitest";
import { loadLeaderboard } from "../app/leaderboard-data";

afterEach(() => vi.unstubAllGlobals());

test("syncs the Firebase user before loading rankings, including their profile", async () => {
  let finishSync!: (response: Response) => void;
  const sync = new Promise<Response>((resolve) => {
    finishSync = resolve;
  });
  const entry = { rank: 1, user_id: 42, name: "Charter", pnl: 0 };
  const request = vi
    .fn()
    .mockReturnValueOnce(sync)
    .mockResolvedValueOnce(Response.json([entry]));
  vi.stubGlobal("fetch", request);
  const result = loadLeaderboard({ getIdToken: async () => "firebase-token" });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenNthCalledWith(
    1,
    "/api/auth/me",
    expect.objectContaining({
      headers: { Authorization: "Bearer firebase-token" },
      cache: "no-store",
    }),
  );
  finishSync(Response.json({ user_id: 42 }));
  await expect(result).resolves.toEqual({
    entries: [entry],
    currentUserId: 42,
  });
  expect(request).toHaveBeenNthCalledWith(
    2,
    "/api/leaderboard/profiles",
    expect.any(Object),
  );
});

test.each([
  [401, "Firebase session could not be verified"],
  [503, "profile could not sync right now"],
  [500, "profile could not sync"],
])(
  "reports profile synchronization failure (%d) rather than an empty board",
  async (status, message) => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response("error", { status }));
    vi.stubGlobal("fetch", request);
    await expect(
      loadLeaderboard({ getIdToken: async () => "token" }),
    ).rejects.toThrow(message);
    expect(request).toHaveBeenCalledTimes(1);
  },
);

test("signed-out visitors can read rankings without Firebase authentication", async () => {
  const request = vi.fn().mockResolvedValue(Response.json([]));
  vi.stubGlobal("fetch", request);
  await expect(loadLeaderboard(null)).resolves.toEqual({
    entries: [],
    currentUserId: null,
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(
    "/api/leaderboard/profiles",
    expect.any(Object),
  );
});
