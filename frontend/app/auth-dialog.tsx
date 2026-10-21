"use client";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile, type User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { auth } from "./firebase";
type Mode = "signup" | "login";
export function AuthDialog({ mode, onClose }: {
    mode: Mode;
    onClose: () => void;
}) {
    const [currentMode, setMode] = useState(mode);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => { dialog.current?.showModal(); }, []);
    return <dialog ref={dialog} className="auth-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget)
        onClose(); }}>
    <button className="close-button" aria-label="Close account dialog" onClick={onClose}>×</button>
    <span className="eyebrow">YOUR NEXT GREAT CALL STARTS HERE</span>
    <h2>{currentMode === "signup" ? "Find your rhythm." : "Welcome back."}</h2>
    <p className="muted">{currentMode === "signup" ? "Create your Octave account to get in on the music." : "Log in to keep your predictions in play."}</p>
    <form onSubmit={async (event) => {
            event.preventDefault();
            if (busy)
                return;
            const data = new FormData(event.currentTarget);
            const username = String(data.get("username") ?? "").trim();
            if (currentMode === "signup" && !username) {
                setMessage("Please enter a username.");
                return;
            }
            setBusy(true);
            setMessage(currentMode === "signup" ? "Creating account…" : "Signing in…");
            try {
                const email = String(data.get("email"));
                const password = String(data.get("password"));
                const result = currentMode === "signup" ? await createUserWithEmailAndPassword(auth, email, password) : await signInWithEmailAndPassword(auth, email, password);
                if (currentMode === "signup")
                    await updateProfile(result.user, { displayName: username });
                const idToken = await result.user.getIdToken();
                const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${idToken}` } });
                if (!response.ok)
                    throw new Error(`Firebase signed you in, but backend verification failed (${response.status}).`);
                setMessage(currentMode === "signup" ? "Account created successfully!" : "Signed in successfully!");
            }
            catch (error) {
                setMessage(error instanceof Error ? error.message : "Could not complete authentication.");
            }
            finally {
                setBusy(false);
            }
        }}>
      {currentMode === "signup" && <label>Username<input name="username" required autoComplete="username"/></label>}
      <label>Email<input name="email" type="email" required autoComplete="email"/></label>
      <label>Password<input name="password" type="password" required minLength={currentMode === "signup" ? 8 : undefined} maxLength={currentMode === "signup" ? 32 : undefined} autoComplete={currentMode === "signup" ? "new-password" : "current-password"}/></label>
      <button className="primary" disabled={busy}>{busy ? "One moment…" : currentMode === "signup" ? "Create account →" : "Log in →"}</button>
      <p role="status" className="auth-status">{message}</p>
    </form>
    <button className="text-button" onClick={() => { setMode(currentMode === "signup" ? "login" : "signup"); setMessage(""); }}>{currentMode === "signup" ? "Already have an account? Log in" : "New to Octave? Sign up"}</button>
  </dialog>;
}
export function useOctaveUser() {
    const [user, setUser] = useState<User | null>(null);
    useEffect(() => onAuthStateChanged(auth, setUser), []);
    return { user, logout: () => signOut(auth) };
}
