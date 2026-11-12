'use client';
/**
 * Accounts administration screen for the clinic lead (Figma style, token-aligned).
 * Allows listing, creating new accounts with one-time temporary passwords, and disabling accounts.
 */
import React, { useEffect, useId, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import type { Role } from '@/types/halqa';
import {
  Avatar, Button, Card, Chip, Dialog, Empty, Field, Input, Loading, SaveButton, Select, initialsOf,
} from '@/components/design/primitives';
import { callServer } from '@/components/design/request';

export interface AccountSummary {
  id: string;
  email: string;
  name: string;
  role: Role;
  org: string;
  licence?: string;
  patientCase?: string;
  mustChangePassword: boolean;
  disabled: boolean;
}

const ROLE_LABELS: Record<Role, string> = {
  NAVIGATOR: 'Care navigator',
  PCP: 'Primary care doctor',
  SPECIALIST: 'Specialist clinician',
  LEAD: 'Clinic lead',
  PATIENT: 'Patient',
};

const ROLE_TONES: Record<Role, 'teal' | 'sky' | 'violet' | 'amber' | 'slate'> = {
  NAVIGATOR: 'teal',
  PCP: 'sky',
  SPECIALIST: 'violet',
  LEAD: 'amber',
  PATIENT: 'slate',
};

export function AccountsPage() {
  const { user, csrf } = useHalqa();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<AccountSummary | null>(null);
  const [createdResult, setCreatedResult] = useState<{ account: AccountSummary; temporaryPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await callServer<{ accounts?: AccountSummary[] }>('/api/admin/users', { cache: 'no-store' }, 'We could not load the accounts. Please try again.');
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not load the accounts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user.person.role === 'LEAD') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the account list from the server when the screen opens
      void fetchAccounts();
    }
  }, [user.person.role]);

  if (user.person.role !== 'LEAD') {
    return <Empty title="Accounts" text="Only clinic leads can manage user accounts." />;
  }

  const handleDisable = async (targetId: string) => {
    setActionPending(true);
    try {
      await callServer(`/api/admin/users/${targetId}/disable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-halqa-csrf': csrf },
      }, 'We could not disable this account. Please try again.');
      setConfirmDisable(null);
      await fetchAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not disable this account. Please try again.');
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-page-title text-slate-900">User accounts</h1>
          <p className="mt-2 text-body text-slate-700">
            Create and manage accounts for doctors, navigators, and specialists in your network.
          </p>
        </div>
        <Button kind="primary" onClick={() => { setShowCreate(true); setCreatedResult(null); }}>
          Create new account
        </Button>
      </header>

      {error && (
        <div role="alert" className="rounded-card border border-rose-600/30 bg-rose-50 p-4 text-[15px] font-medium text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <Loading label="Loading accounts…" />
      ) : accounts.length === 0 ? (
        <Empty title="No accounts found" text="Create the first account using the button above." />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <ul className="divide-y divide-slate-200">
            {accounts.map((acc) => {
              const isSelf = acc.id === user.id;
              return (
                <li key={acc.id} className="flex flex-wrap items-center justify-between gap-4 p-5 sm:px-6">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <Avatar initials={initialsOf(acc.name)} tone={acc.disabled ? 'slate' : undefined} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[17px] font-semibold text-slate-900">{acc.name}</span>
                        {isSelf && <span className="text-[14px] font-medium text-teal-800">(You)</span>}
                        <Chip tone={ROLE_TONES[acc.role]}>{ROLE_LABELS[acc.role] ?? acc.role}</Chip>
                        {acc.disabled ? (
                          <Chip tone="rose" dot>Disabled</Chip>
                        ) : acc.mustChangePassword ? (
                          <Chip tone="amber">Temporary password</Chip>
                        ) : (
                          <Chip tone="emerald" dot>Active</Chip>
                        )}
                      </div>
                      <p className="mt-1 text-[15px] text-slate-600 truncate">
                        {acc.email} · {acc.org}
                        {acc.licence && ` · Licence: ${acc.licence}`}
                        {acc.patientCase && ` · Case: ${acc.patientCase}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {!isSelf && !acc.disabled && (
                      <Button
                        kind="quiet"
                        size="md"
                        className="!text-rose-600 hover:!bg-rose-50"
                        onClick={() => setConfirmDisable(acc)}
                      >
                        Disable
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Create Account Modal */}
      {showCreate && (
        <Dialog
          title={createdResult ? 'Account created' : 'Create new account'}
          onClose={() => { setShowCreate(false); setCreatedResult(null); }}
        >
          {createdResult ? (
            <div className="space-y-5">
              <div className="rounded-card border border-emerald-600/30 bg-emerald-50 p-5">
                <p className="text-[16px] font-semibold text-emerald-800">
                  Account for {createdResult.account.name} is ready.
                </p>
                <p className="mt-2 text-[14px] text-slate-700">
                  Share this temporary password securely. The user will be required to choose a new password on their first sign-in.
                </p>
                <div className="mt-4 flex items-center gap-3 rounded-input border border-slate-300 bg-white p-3 font-mono text-[16px] text-slate-900">
                  <span className="flex-1 select-all">{createdResult.temporaryPassword}</span>
                  <Button
                    kind="secondary"
                    size="md"
                    onClick={() => {
                      void navigator.clipboard.writeText(createdResult.temporaryPassword);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 3000);
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button kind="primary" onClick={() => { setShowCreate(false); setCreatedResult(null); }}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <CreateAccountForm
              csrf={csrf}
              onCreated={(res) => {
                setCreatedResult(res);
                void fetchAccounts();
              }}
              onCancel={() => setShowCreate(false)}
            />
          )}
        </Dialog>
      )}

      {/* Confirm Disable Modal */}
      {confirmDisable && (
        <Dialog
          title="Disable account"
          onClose={() => setConfirmDisable(null)}
          footer={(
            <>
              <Button kind="quiet" onClick={() => setConfirmDisable(null)} disabled={actionPending}>
                Cancel
              </Button>
              <SaveButton
                kind="danger"
                disabled={actionPending}
                onClick={() => handleDisable(confirmDisable.id)}
              >
                {actionPending ? 'Disabling…' : 'Disable account'}
              </SaveButton>
            </>
          )}
        >
          <p className="text-[16px] text-slate-700">
            Are you sure you want to disable the account for <strong>{confirmDisable.name}</strong> ({confirmDisable.email})?
          </p>
          <p className="mt-3 text-[14px] text-slate-500">
            This will immediately end their active sessions and prevent them from signing in. Past actions and audit records are preserved.
          </p>
        </Dialog>
      )}
    </div>
  );
}

function CreateAccountForm({
  csrf,
  onCreated,
  onCancel,
}: {
  csrf: string;
  onCreated: (res: { account: AccountSummary; temporaryPassword: string }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('NAVIGATOR');
  const [org, setOrg] = useState('');
  const [licence, setLicence] = useState('');
  const [patientCase, setPatientCase] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPending(true);

    try {
      const payload: Record<string, string> = {
        name: name.trim(),
        email: email.trim(),
        role,
        org: org.trim(),
      };
      if (licence.trim()) payload.licence = licence.trim();
      if (role === 'PATIENT' && patientCase.trim()) payload.patientCase = patientCase.trim();

      const data = await callServer<{ account: AccountSummary; temporaryPassword: string }>('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-halqa-csrf': csrf },
        body: JSON.stringify(payload),
      }, 'We could not create this account. Check the details and try again.');
      onCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not create this account. Check the details and try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Full name" htmlFor={`${id}-name`}>
        <Input
          id={`${id}-name`}
          required
          value={name}
          placeholder="Full name"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Email" htmlFor={`${id}-email`}>
        <Input
          id={`${id}-email`}
          required
          type="email"
          value={email}
          placeholder="Email address"
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Role" htmlFor={`${id}-role`}>
          <Select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="NAVIGATOR">Care navigator</option>
            <option value="PCP">Primary care doctor</option>
            <option value="SPECIALIST">Specialist clinician</option>
            <option value="LEAD">Clinic lead</option>
            <option value="PATIENT">Patient</option>
          </Select>
        </Field>

        <Field label="Organisation or clinic" htmlFor={`${id}-org`}>
          <Input
            id={`${id}-org`}
            required
            value={org}
            placeholder="Organisation"
            onChange={(e) => setOrg(e.target.value)}
          />
        </Field>
      </div>

      {(role === 'PCP' || role === 'SPECIALIST' || role === 'LEAD') && (
        <Field label="Professional licence number (optional)" htmlFor={`${id}-lic`}>
          <Input
            id={`${id}-lic`}
            value={licence}
            placeholder="Licence number, if the role needs one"
            onChange={(e) => setLicence(e.target.value)}
          />
        </Field>
      )}

      {role === 'PATIENT' && (
        <Field label="Linked Case ID" htmlFor={`${id}-case`} hint="The case this patient account belongs to.">
          <Input
            id={`${id}-case`}
            required
            value={patientCase}
            placeholder="Case ID of this patient"
            onChange={(e) => setPatientCase(e.target.value)}
          />
        </Field>
      )}

      {error && (
        <p role="alert" className="rounded-input bg-rose-50 px-4 py-3 text-[14px] font-medium text-rose-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-3">
        <Button kind="quiet" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <SaveButton type="submit" kind="primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create account'}
        </SaveButton>
      </div>
    </form>
  );
}
