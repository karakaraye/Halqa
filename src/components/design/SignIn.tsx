'use client';
/** Staff and patient sign-in (Figma: "Sign-in — desktop", node 11:2). */
import React, { useState } from 'react';
import { Button, Field, Input } from './primitives';

export function SignIn({ error, onSignIn }: { error: string; onSignIn: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const message = failure || error;

  return (
    <main className="grid min-h-screen grid-cols-1 bg-slate-50 min-[900px]:grid-cols-[640fr_800fr]">
      <section className="flex flex-col bg-teal-800 px-6 py-10 text-white sm:px-12 min-[900px]:px-20 min-[900px]:py-20">
        <span aria-hidden="true" className="h-14 w-14 rounded-full bg-teal-100" />
        <p className="sr-only">Halqa</p>
        <h1 className="mt-8 max-w-[460px] text-[32px] font-bold leading-[1.25] min-[900px]:text-[44px]">
          Keep every patient’s follow-up on track.
        </h1>
        <p className="mt-6 max-w-[460px] text-[16px] leading-6 text-teal-50 min-[900px]:text-[18px] min-[900px]:leading-7">
          Halqa makes sure a screening result turns into care, so nobody gets lost along the way.
        </p>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[480px] rounded-card border border-slate-200 bg-white p-6 sm:p-12">
          <h2 className="text-[32px] font-bold leading-10 text-slate-900">Welcome back</h2>
          <p className="mt-4 text-[16px] text-slate-500">Sign in with the email your administrator gave you.</p>

          <form
            className="mt-6 space-y-6"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setFailure('');
              try { await onSignIn(email, password); }
              catch (err) { setFailure(err instanceof Error ? err.message : 'Sign-in failed.'); }
              finally { setPending(false); }
            }}
          >
            <Field label="Email" htmlFor="signin-email">
              <Input
                id="signin-email"
                required
                type="email"
                autoComplete="username"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password" htmlFor="signin-password">
              <Input
                id="signin-password"
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {message && (
              <p role="alert" className="rounded-input bg-rose-50 px-4 py-3 text-[14px] font-medium text-rose-600">{message}</p>
            )}
            <Button type="submit" kind="primary" full disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
          </form>

          <p className="mt-6 text-[14px] text-slate-500">Forgot your password? Ask your administrator to reset it.</p>
        </div>
      </section>
    </main>
  );
}
