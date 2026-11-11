'use client';

import React, { useEffect, useState } from 'react';
import { HalqaProvider, useHalqa } from '@/context/HalqaStore';
import { Header, Toasts } from '@/components/Header';
import { CommandCentre } from '@/components/CommandCentre';
import { SpecialistInbox } from '@/components/SpecialistInbox';
import { PatientApp } from '@/components/PatientApp';
import { ImpactDashboard } from '@/components/ImpactDashboard';
import { Governance } from '@/components/Governance';
import { CaseDrawer } from '@/components/case/CaseDrawer';
import { DemoGuide } from '@/components/DemoGuide';

function App() {
  const { s } = useHalqa();
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 lg:px-6 py-5 pb-24">
        {s.view === 'command' && <CommandCentre />}
        {s.view === 'specialist' && <SpecialistInbox />}
        {s.view === 'patient' && <PatientApp />}
        {s.view === 'impact' && <ImpactDashboard />}
        {s.view === 'governance' && <Governance />}
      </main>
      <footer className="border-t border-slate-200 bg-white py-3 text-center text-[11px] text-slate-500">
        Halqa (حَلْقَة, “the loop”) · Prototype with simulated data only, no real patient information · FHIR R4–aligned
      </footer>
      <CaseDrawer />
      <Toasts />
      <DemoGuide />
    </div>
  );
}

export default function Home() {
  // Render client-side only: the demo runs on a simulated clock persisted in localStorage.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="min-h-screen grid place-items-center text-sm text-slate-400">Loading Halqa…</div>;
  return (
    <HalqaProvider>
      <App />
    </HalqaProvider>
  );
}
