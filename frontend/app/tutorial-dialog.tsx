"use client";
import { useState } from "react";
import {
  TUTORIAL_DONE_KEY,
  TUTORIAL_STEPS,
  advance,
  tutorialStart,
  type TutorialState,
} from "./tutorial";

export function Tutorial() {
  const [state, setState] = useState<TutorialState>(() =>
    tutorialStart(typeof window === "undefined" ? null : window.localStorage),
  );
  if (state === "done") return null;
  const step = TUTORIAL_STEPS[state];
  const go = (action: "next" | "back" | "skip") => {
    const next = advance(state, action);
    if (next === "done") {
      try {
        localStorage.setItem(TUTORIAL_DONE_KEY, "1");
      } catch {}
    }
    setState(next);
  };
  return (
    <div
      className="fixed right-6 bottom-6 z-50 w-[min(360px,calc(100vw-32px))] rounded-[9px] border border-line bg-white p-5 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
    >
      <span className="inline-flex items-center gap-[10px] text-[9px] font-bold tracking-[1.6px] text-[#787c70]">
        STEP {state + 1} OF {TUTORIAL_STEPS.length}
      </span>
      <h2 id="tutorial-title" className="my-2 text-[18px] font-medium">
        {step.title}
      </h2>
      <p className="text-[13px] leading-[1.6] text-muted">{step.body}</p>
      <div className="mt-[14px] flex items-center justify-end gap-[9px]">
        <button
          className="inline-flex items-center gap-[9px] py-2 text-[12px]"
          onClick={() => go("skip")}
        >
          Skip
        </button>
        {state > 0 && (
          <button
            className="inline-flex items-center justify-between gap-[25px] rounded-[7px] border border-[#b8bbae] bg-transparent px-[19px] py-3 text-[13px] font-semibold text-ink hover:bg-[#eeeee5]"
            onClick={() => go("back")}
          >
            Back
          </button>
        )}
        <button
          className="inline-flex items-center justify-between gap-[25px] rounded-[7px] border border-ink-strong bg-ink-strong px-[19px] py-3 text-[13px] font-semibold text-white hover:bg-[#414b40]"
          onClick={() => go("next")}
        >
          {state === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
