"use client";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { auth } from "./firebase";

type Mode = "signup" | "login";

export function AuthDialog({
  mode,
  onClose,
}: {
  mode: Mode;
  onClose: () => void;
}) {
  const [currentMode, setMode] = useState(mode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[440px] overflow-y-auto rounded-[14px] border border-[#dfdfd2] bg-bg p-[38px] text-[#30372b] shadow-[0_25px_100px_#0002] max-[580px]:px-[25px] max-[580px]:py-[32px]"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        className="absolute right-4 top-3 text-[27px] text-[#8b907d]"
        aria-label="Close account dialog"
        onClick={onClose}
      >
        ×
      </button>
      <h2 className="mt-5 mb-3 font-serif text-[37px] font-normal tracking-[-1.5px]">
        {currentMode === "signup" ? "Find your rhythm." : "Welcome back."}
      </h2>
      <p className="mb-[25px] text-[12px] leading-[1.7] text-muted">
        {currentMode === "signup"
          ? "Create your Octave account to get in on the music."
          : "Log in to keep your predictions in play."}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const data = new FormData(event.currentTarget);
          const username = String(data.get("username") ?? "").trim();
          if (currentMode === "signup" && !username) {
            setMessage("Please enter a username.");
            return;
          }
          setBusy(true);
          setMessage(
            currentMode === "signup" ? "Creating account…" : "Signing in…",
          );
          try {
            const email = String(data.get("email"));
            const password = String(data.get("password"));
            const result =
              currentMode === "signup"
                ? await createUserWithEmailAndPassword(auth, email, password)
                : await signInWithEmailAndPassword(auth, email, password);
            if (currentMode === "signup") {
              await updateProfile(result.user, { displayName: username });
              await result.user.reload();
            }
            const idToken = await result.user.getIdToken(true);
            const response = await fetch("/api/auth/me", {
              headers: { Authorization: `Bearer ${idToken}` },
            });
            if (!response.ok)
              throw new Error(
                `Firebase signed you in, but backend verification failed (${response.status}).`,
              );
            setMessage(
              currentMode === "signup"
                ? "Account created successfully!"
                : "Signed in successfully!",
            );
            onClose();
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Could not complete authentication.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {currentMode === "signup" && (
          <label className="my-[17px] block text-[12px]">
            Username
            <input
              name="username"
              required
              autoComplete="username"
              className="mt-2 block w-full rounded-[5px] border border-[#d8dccd] bg-[#fffdf7] p-3"
            />
          </label>
        )}
        <label className="my-[17px] block text-[12px]">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-2 block w-full rounded-[5px] border border-[#d8dccd] bg-[#fffdf7] p-3"
          />
        </label>
        <label className="my-[17px] block text-[12px]">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={currentMode === "signup" ? 8 : undefined}
            maxLength={currentMode === "signup" ? 32 : undefined}
            autoComplete={
              currentMode === "signup" ? "new-password" : "current-password"
            }
            className="mt-2 block w-full rounded-[5px] border border-[#d8dccd] bg-[#fffdf7] p-3"
          />
        </label>
        <button
          className="mt-[5px] inline-flex w-full items-center justify-center gap-[25px] rounded-[7px] border border-ink-strong bg-ink-strong px-[22px] py-[15px] text-[13px] font-semibold text-white hover:bg-[#414b40]"
          disabled={busy}
        >
          {busy
            ? "One moment…"
            : currentMode === "signup"
              ? "Create account →"
              : "Log in →"}
        </button>
        <p
          role="status"
          className="text-[11px] leading-[1.6] [overflow-wrap:anywhere]"
        >
          {message}
        </p>
      </form>
      <button
        className="mx-auto block py-2 text-[11px] text-[#828b75]"
        onClick={() => {
          setMode(currentMode === "signup" ? "login" : "signup");
          setMessage("");
        }}
      >
        {currentMode === "signup"
          ? "Already have an account? Log in"
          : "New to Octave? Sign up"}
      </button>
    </dialog>
  );
}

export function useOctaveUser() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return { user, logout: () => signOut(auth) };
}
