"use client";
import { useState } from "react";
import { TUTORIAL_DONE_KEY, TUTORIAL_STEPS, advance, tutorialStart, type TutorialState } from "./tutorial";

export function Tutorial() {
    const [state, setState] = useState<TutorialState>(() => tutorialStart(window.localStorage));
    if (state === "done")
        return null;
    const step = TUTORIAL_STEPS[state];
    const go = (action: "next" | "back" | "skip") => {
        const next = advance(state, action);
        if (next === "done") {
            try { localStorage.setItem(TUTORIAL_DONE_KEY, "1"); } catch { /* private window: show again next time */ }
        }
        setState(next);
    };
    return <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <span className="eyebrow">STEP {state + 1} OF {TUTORIAL_STEPS.length}</span>
      <h2 id="tutorial-title">{step.title}</h2>
      <p>{step.body}</p>
      <div className="tutorial-actions">
        <button className="text-button" onClick={() => go("skip")}>Skip</button>
        {state > 0 && <button className="primary secondary small" onClick={() => go("back")}>Back</button>}
        <button className="primary small" onClick={() => go("next")}>{state === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"}</button>
      </div>
    </div>;
}
