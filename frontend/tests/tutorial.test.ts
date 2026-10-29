import { expect, test } from "vitest";
import { TUTORIAL_DONE_KEY, TUTORIAL_STEPS, advance, tutorialStart, type TutorialState } from "../app/tutorial";

test("a new user can step through the whole walkthrough", () => {
    let state: TutorialState = tutorialStart({ getItem: () => null });
    expect(state).toBe(0);
    for (let i = 0; i < TUTORIAL_STEPS.length - 1; i++)
        state = advance(state, "next");
    expect(state).toBe(TUTORIAL_STEPS.length - 1);
    expect(advance(state, "next")).toBe("done");
});

test("back, skip, and a finished walkthrough stays finished", () => {
    expect(advance(2, "back")).toBe(1);
    expect(advance(0, "back")).toBe(0);
    expect(advance(1, "skip")).toBe("done");
    expect(advance("done", "next")).toBe("done");
    expect(tutorialStart({ getItem: key => (key === TUTORIAL_DONE_KEY ? "1" : null) })).toBe("done");
});
