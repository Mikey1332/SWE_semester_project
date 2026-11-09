export type TutorialStep = { title: string; body: string };

export const TUTORIAL_STEPS: TutorialStep[] = [
    { title: "Welcome to Octave", body: "You start with ♫ 10,000 Music Notes to predict moves on the Billboard Hot 100." },
    { title: "Pick a market", body: "Each card asks whether a song will rise or fall a number of spots on next week's chart." },
    { title: "Buy YES or NO", body: "Prices run from ♫ 1 to ♫ 99, and YES plus NO always cost ♫ 100. Choose how many contracts to buy." },
    { title: "Sell or hold", body: "Sell contracts back any time before the market closes, or hold them until the chart comes out." },
    { title: "Get paid", body: "When the chart is in, every winning contract pays ♫ 100. See all your trades in My ledger." },
];

export const TUTORIAL_DONE_KEY = "octave-tutorial-done";

// The walkthrough's position: the current step index, or "done".
export type TutorialState = number | "done";

export function advance(state: TutorialState, action: "next" | "back" | "skip"): TutorialState {
    if (state === "done")
        return state;
    if (action === "skip")
        return "done";
    if (action === "back")
        return Math.max(0, state - 1);
    return state + 1 >= TUTORIAL_STEPS.length ? "done" : state + 1;
}

// New users start at step 0; anyone who finished or skipped it before doesn't see it again.
export function tutorialStart(storage: Pick<Storage, "getItem"> | null): TutorialState {
    try {
        return storage?.getItem(TUTORIAL_DONE_KEY) === "1" ? "done" : 0;
    }
    catch {
        return 0;
    }
}
