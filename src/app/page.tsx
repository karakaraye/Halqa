'use client';

import React, { useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { HalqaProvider, useHalqa } from '@/context/HalqaStore';
import { Shell, tabForView } from '@/components/design/Shell';
import { Loading } from '@/components/design/primitives';
import { StoreBanners } from '@/components/design/StoreBanners';
import { MyWork } from '@/components/staff/MyWork';
import { NotOnList } from '@/components/staff/NotOnList';
import { ChangePasswordScreen } from '@/components/design/ChangePassword';

// Screens load on demand so the sign-in route ships only the sign-in code.
const loading = () => <Loading />;
const CasePage = dynamic(() => import('@/components/staff/CasePage').then((m) => m.CasePage), { loading });
const Referrals = dynamic(() => import('@/components/staff/Referrals').then((m) => m.Referrals), { loading });
const Overview = dynamic(() => import('@/components/staff/Overview').then((m) => m.Overview), { loading });
const Approvals = dynamic(() => import('@/components/staff/Approvals').then((m) => m.Approvals), { loading });
const AccountsPage = dynamic(() => import('@/components/staff/AccountsPage').then((m) => m.AccountsPage), { loading });
const PatientPortal = dynamic(() => import('@/components/patient/PatientPortal').then((m) => m.PatientPortal), {
  loading: () => <div className="min-h-screen bg-slate-50 p-4"><Loading /></div>,
});

function App() {
  const { s, user, notOnList } = useHalqa();
  if (user.mustChangePassword) return <><StoreBanners /><ChangePasswordScreen /></>;
  // The patient portal shows the store banners itself, in the patient's language.
  if (user.person.role === 'PATIENT') return <PatientPortal />;
  let screen: React.ReactNode;
  if (s.selectedId) screen = <CasePage />;
  else if (notOnList) screen = <NotOnList />;
  else if (s.view === 'command') screen = <MyWork />;
  else if (s.view === 'specialist') screen = <Referrals />;
  else if (s.view === 'governance') screen = <Approvals />;
  else if (s.view === 'accounts') screen = <AccountsPage />;
  else screen = <Overview />; // 'impact', and 'patient' as fallback
  return (
    <>
      <StoreBanners />
      <Shell active={tabForView(s.view)}>{screen}</Shell>
    </>
  );
}

export default function Home() {
  // The provider authenticates and loads the shared server workspace after mount.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <div className="min-h-screen grid place-items-center text-[16px] text-slate-500">Loading Halqa…</div>;
  return (
    <HalqaProvider>
      <App />
    </HalqaProvider>
  );
}
