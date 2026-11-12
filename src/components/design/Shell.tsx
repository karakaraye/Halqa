'use client';
/** Staff top bar (Figma: "My work — desktop", node 11:22) with role-based tabs. */
import React, { useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import type { View } from '@/context/HalqaStore';
import type { Role } from '@/types/halqa';
import { Avatar, Button, cx, initialsOf } from './primitives';
import { ChangePasswordDialog } from './ChangePassword';

export type ShellTab = 'My work' | 'Referrals' | 'Overview' | 'Approvals' | 'Accounts';

export const TAB_VIEW: Record<ShellTab, View> = {
  'My work': 'command',
  Referrals: 'specialist',
  Overview: 'impact',
  Approvals: 'governance',
  Accounts: 'accounts',
};

export function tabsForRole(role: Role | string): ShellTab[] {
  if (role === 'SPECIALIST') return ['Referrals', 'Overview'];
  if (role === 'LEAD') return ['Overview', 'Approvals', 'Accounts'];
  return ['My work', 'Overview']; // NAVIGATOR, PCP
}

export function tabForView(view: View): ShellTab {
  const found = (Object.keys(TAB_VIEW) as ShellTab[]).find((k) => TAB_VIEW[k] === view);
  return found ?? 'Overview';
}

export function Shell({ active, children }: { active: ShellTab | string; children?: React.ReactNode }) {
  const { d, user, signOut, busy } = useHalqa();
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const tabs = tabsForRole(user.person.role);
  const name = user.person.name;

  return (
    <div className="min-h-screen overflow-x-hidden">
      <div className="mx-auto w-full max-w-[1440px] px-4 pt-4 sm:px-6 lg:px-12 lg:pt-12">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card bg-white px-4 py-3 sm:px-10 sm:py-4">
          <div className="flex items-center gap-2" aria-label="Halqa">
            <span aria-hidden="true" className="h-8 w-8 rounded-full bg-teal-700" />
            <span className="text-[22px] font-bold text-slate-900">Halqa</span>
          </div>

          <nav aria-label="Main" className="order-3 w-full md:order-none md:w-auto md:flex-1">
            <ul className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const on = tab === active;
                return (
                  <li key={tab}>
                    <button
                      type="button"
                      aria-current={on ? 'page' : undefined}
                      onClick={() => { d({ type: 'SELECT', id: null }); d({ type: 'VIEW', view: TAB_VIEW[tab] }); }}
                      className={cx(
                        'min-h-[48px] rounded-full px-4 text-[16px] font-medium transition-colors',
                        on ? 'bg-teal-50 text-teal-800 font-semibold' : 'text-slate-900 hover:bg-slate-100',
                      )}
                    >
                      {tab}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[16px] text-slate-900 sm:inline">{name}</span>
            <Avatar initials={initialsOf(name)} label={name} />
            <Button kind="quiet" size="md" onClick={() => setShowPasswordDialog(true)}>Password</Button>
            <Button kind="quiet" size="md" onClick={() => { void signOut(); }} aria-busy={busy || undefined}>Sign out</Button>
          </div>
        </header>

      </div>

      <main className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-6 sm:px-6 lg:px-[84px] lg:pt-9">
        {children}
      </main>

      {showPasswordDialog && <ChangePasswordDialog onClose={() => setShowPasswordDialog(false)} />}
    </div>
  );
}
