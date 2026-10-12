"use client";

import {
  createUserWithEmailAndPassword,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";
import Image from "next/image";
import { useState } from "react";

async function verifyWithBackend(user: User): Promise<void> {
  const idToken = await user.getIdToken();

  const response = await fetch("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Firebase signed you in, but backend verification failed (${response.status}).`,
    );
  }
}

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [username, setUsername] = useState("");

  return (
    <main className="w-full max-w-md mx-auto px-6 py-16">
      <Image
        src="/octave-white.png"
        alt="Octave logo"
        width={2170}
        height={725}
        className="w-56 h-auto mb-8"
      />

      <h1 className="text-3xl font-semibold tracking-tight mb-3">
        Create an account
      </h1>

      <p className="text-base text-neutral-400 mb-8">
        Join Octave to start trading music.
      </p>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;

          if (username.trim() === "") {
            setMessage("Please enter a username.");
            return;
          }

          setBusy(true);
          setMessage("Creating account...");

          try {
            const result = await createUserWithEmailAndPassword(
              auth,
              email,
              password
            );

            await updateProfile(result.user, {
              displayName: username.trim(),
            });

            await verifyWithBackend(result.user);
            setMessage("Account created successfully!");
          } catch (error) {
            if (error instanceof Error) {
              setMessage(error.message);
            } else {
              setMessage("Could not complete signup.");
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="username" className="block mb-2">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          autoComplete="username"
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 mb-5"
        />

        <label htmlFor="email" className="block mb-2">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 mb-5"
        />

        <label htmlFor="password" className="block mb-2">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          maxLength={32}
          required
          autoComplete="new-password"
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 mb-5"
        />

        <button
          type="submit"
          className="w-full bg-white text-black font-semibold rounded-lg py-3 mt-2 hover:bg-neutral-200"
          disabled={busy}
        >
          Create account
        </button>

        <p role="status" className="mt-4 text-sm text-neutral-400">
          {message}
        </p>
      </form>
    </main>
  );
}