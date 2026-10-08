"use client";

import Image from "next/image";
import { useState } from "react";

export default function Home() {
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
          setMessage("Sending...");

      try {
        const response = await fetch("/api/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: username,
            email: email,
            password: password,
          }),
        });

        if (!response.ok) {
          const errorMessage = await response.text();
          setMessage(errorMessage);
          return;
        }

        const result = await response.json();
        setMessage(result.message);
      } catch {
        setMessage("Could not reach the server. Check that both servers are running.");
      }
      }}
    >
        <label htmlFor="username" className="block text-base font-medium mb-2">
          Username
        </label>

        <input
          id="username"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          type="text"
          required
          autoComplete="username"
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-base mb-5 outline-none focus:border-white focus:ring-1 focus:ring-white"
        />

        <label htmlFor="email" className="block text-base font-medium mb-2">
          Email
        </label>

        <input
          id="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          autoComplete="email"
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-base mb-5 outline-none focus:border-white focus:ring-1 focus:ring-white"
        />

        <label htmlFor="password" className="block text-base font-medium mb-2">
          Password
        </label>

        <input
          id="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          maxLength={32}
          minLength={8}
          required
          autoComplete="new-password"
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-base mb-5 outline-none focus:border-white focus:ring-1 focus:ring-white"
        />

        <button
          type="submit"
          className="w-full bg-white text-black font-semibold rounded-lg py-3 mt-2 hover:bg-neutral-200 transition-colors"
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