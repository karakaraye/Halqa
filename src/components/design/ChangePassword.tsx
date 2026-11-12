'use client';
import React, { useState } from 'react';
import { Button, Card, Dialog, Field, Input, SaveButton } from './primitives';
import { useHalqa } from '@/context/HalqaStore';
import { callServer } from './request';

export function ChangePasswordForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel?: () => void;
}) {
  const { refresh, csrf } = useHalqa();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword.length < 12) {
      setError('New password must have at least 12 characters.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setPending(true);
    try {
      await callServer('/api/account/password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-halqa-csrf': csrf,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      }, 'We could not change your password. Please try again.');
      await refresh();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not change your password. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Current password" htmlFor="current-pw">
        <Input
          id="current-pw"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </Field>
      <Field label="New password (at least 12 characters)" htmlFor="new-pw">
        <Input
          id="new-pw"
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm-pw">
        <Input
          id="confirm-pw"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </Field>
      {error && (
        <p role="alert" className="rounded-input bg-rose-50 px-4 py-3 text-[14px] font-medium text-rose-600">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        {onCancel && (
          <Button kind="quiet" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <SaveButton type="submit" kind="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save new password'}
        </SaveButton>
      </div>
    </form>
  );
}

export function ChangePasswordScreen() {
  const { signOut } = useHalqa();
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-[500px]">
        <Card className="!p-8 sm:!p-10 shadow-lg">
          <div className="flex items-center gap-2 mb-6" aria-label="Halqa">
            <span aria-hidden="true" className="h-7 w-7 rounded-full bg-teal-700" />
            <span className="text-[20px] font-bold text-slate-900">Halqa</span>
          </div>
          <h1 className="text-[26px] font-bold leading-tight text-slate-900">Set a new password</h1>
          <p className="mt-2 mb-6 text-[16px] text-slate-600">
            For security, you must choose a new password before you can view or save records.
          </p>
          <ChangePasswordForm onSuccess={() => {}} />
          <div className="mt-6 border-t border-slate-200 pt-4 text-center">
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex min-h-[48px] items-center px-4 text-[14px] font-semibold text-slate-500 hover:text-slate-800"
            >
              Sign out instead
            </button>
          </div>
        </Card>
      </div>
    </main>
  );
}

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Change your password" onClose={onClose}>
      <p className="-mt-2 mb-5 text-[15px] text-slate-500">
        Choose a secure password with at least 12 characters.
      </p>
      <ChangePasswordForm onSuccess={onClose} onCancel={onClose} />
    </Dialog>
  );
}
