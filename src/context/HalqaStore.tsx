'use client';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { State, Action } from '@/domain/state';
import { currentStep } from '@/lib/engine';
import { Snapshot, PatientSummary, SessionUser } from '@/shared/protocol';
import { Directory } from '@/types/halqa';
import { SignIn } from '@/components/design/SignIn';

export type { Action, State, View } from '@/domain/state';

/**
 * What went wrong, as a code the screens can translate.
 * - network: the request never got an answer (connection lost, server down).
 * - unconfirmed: the server answered with something we could not read.
 * - stale: someone else saved first; the latest record is loaded for review.
 * - save: the server failed (5xx); the same request can be sent again safely.
 * - refused: the server said no (for example 403 or 422); `text` holds its plain reason.
 * - offline: the browser is offline, so nothing was sent.
 * - signOut: signing out failed.
 * - load: reading the workspace failed.
 */
export type ErrorCode = 'network' | 'unconfirmed' | 'stale' | 'save' | 'refused' | 'offline' | 'signOut' | 'load';

export const ERROR_TEXT: Record<ErrorCode, string> = {
  network: 'We could not reach the server. Check your connection and try again.',
  unconfirmed: 'We could not confirm that your change was saved. Try again to check.',
  stale: 'Someone else changed this record. We loaded the latest version. Check it, then try again.',
  save: 'We could not save this change. Please try again.',
  refused: 'We could not do this. Please check and try again.',
  offline: 'You are offline. Reconnect to the internet to save changes.',
  signOut: 'Sign-out failed. Please try again.',
  load: 'We could not load the latest information. Check your connection and try again.',
};

/** `read` errors clear on the next successful poll; `write` errors stay until retried or dismissed. */
interface StoreError { code: ErrorCode; text: string; canRetry: boolean; source: 'read' | 'write' }

/** A result that arrived since the previous poll, waiting to be announced. */
export interface Arrival { id: string; name: string }

interface Ctx {
  s: State;
  d: React.Dispatch<Action>;
  user: SessionUser;
  /** Staff and receiving services of the user's network, from the server. */
  directory: Directory;
  patient?: PatientSummary;
  csrf: string;
  isOnline: boolean;
  testControls: boolean;
  busy: boolean;
  /** Plain English text of the current error, or ''. */
  error: string;
  errorCode: ErrorCode | null;
  canRetry: boolean;
  retry: () => void;
  dismissError: () => void;
  /** New results not yet announced, oldest first. */
  arrivals: Arrival[];
  openArrival: () => void;
  laterArrival: () => void;
  /** The selected patient is no longer readable by this user (404 or gone from the snapshot). */
  notOnList: boolean;
  leaveNotOnList: () => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const StoreCtx = createContext<Ctx | null>(null);
const localActions = ['SELECT', 'VIEW', 'PATIENT_CASE'];
const POLL_MS = 3000;
/** On an unchanged answer the screen clock is moved forward at most once a minute. */
const CLOCK_STEP_MS = 60_000;

class StoreFailure extends Error {
  constructor(public code: ErrorCode, public serverText = '') { super(code); }
}

const readError = (e: unknown): StoreError => {
  const code = e instanceof StoreFailure ? e.code : 'load';
  return { code, text: ERROR_TEXT[code], canRetry: true, source: 'read' };
};

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

export function HalqaProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<StoreError | null>(null);
  const [busy, setBusy] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(online);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [notOnList, setNotOnList] = useState(false);

  const ref = useRef<Snapshot | null>(null);
  const etag = useRef<string | null>(null);
  /** Server time of the last snapshot received from the server (not moved forward locally). */
  const seenNow = useRef(0);
  /** Server clock minus browser clock, from the last snapshot received. */
  const skew = useRef(0);
  const pending = useRef(0);
  const polling = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const epoch = useRef(0);
  const lastFailed = useRef<{ action: Action; requestId: string; revision: number | null } | null>(null);

  /** Forgets everything about the signed-in user: snapshot, cases, directory, banners and the failed action. */
  const clearSession = useCallback(() => {
    epoch.current++;
    ref.current = null;
    etag.current = null;
    seenNow.current = 0;
    lastFailed.current = null;
    setSnapshot(null);
    setArrivals([]);
    setNotOnList(false);
    setErr(null);
  }, []);

  const apply = useCallback((next: Snapshot, preserve = true): boolean => {
    const prior = ref.current;
    if (preserve && prior && prior.user.id === next.user.id) {
      if (next.revision < prior.revision) return false;
      next.state.view = prior.state.view;
      const selected = prior.state.selectedId;
      const stillThere = !!selected && next.state.cases.some((c) => c.id === selected);
      next.state.selectedId = stillThere ? selected : null;
      if (selected && !stillThere) setNotOnList(true);
      next.state.patientCaseId = next.state.cases.some((c) => c.id === prior.state.patientCaseId)
        ? prior.state.patientCaseId
        : next.state.patientCaseId;

      // A new result: not visible before, and opened in the system since the previous snapshot.
      // A case that became visible through a hand-over was opened earlier, so it is not announced.
      const priorIds = new Set(prior.state.cases.map((c) => c.id));
      const since = seenNow.current;
      const fresh = next.state.cases
        .filter((c) => !priorIds.has(c.id) && (c.audit[0]?.at ?? 0) >= since)
        .sort((a, b) => (a.audit[0]?.at ?? 0) - (b.audit[0]?.at ?? 0))
        .map((c) => ({ id: c.id, name: c.patient.name }));
      if (fresh.length) setArrivals((q) => [...q, ...fresh.filter((f) => !q.some((x) => x.id === f.id))]);
    }
    if (preserve) {
      seenNow.current = next.state.now;
      skew.current = next.state.now - Date.now();
    }
    ref.current = next;
    setSnapshot(next);
    return true;
  }, []);

  /** Reads the workspace. Unchanged answers come back as 304 and leave the screen alone. */
  const refresh = useCallback(async () => {
    const generation = epoch.current;
    const headers: Record<string, string> = {};
    if (etag.current && ref.current) headers['if-none-match'] = etag.current;
    let response: Response;
    try {
      response = await fetch('/api/workspace', { cache: 'no-store', headers });
    } catch {
      throw new StoreFailure('network');
    }
    if (generation !== epoch.current) return;
    if (response.status === 401) { clearSession(); return; }
    if (response.status === 304) {
      const current = ref.current;
      const estimate = Date.now() + skew.current;
      if (current && estimate - current.state.now >= CLOCK_STEP_MS) {
        const next = { ...current, state: { ...current.state, now: estimate } };
        ref.current = next;
        setSnapshot(next);
      }
      return;
    }
    let data: Snapshot & { error?: string };
    try {
      data = await response.json();
    } catch {
      throw new StoreFailure('load');
    }
    if (generation !== epoch.current) return;
    if (!response.ok) throw new StoreFailure('load', typeof data?.error === 'string' ? data.error : '');
    if (apply(data)) etag.current = response.headers.get('etag');
  }, [apply, clearSession]);

  const poll = useCallback(() => {
    if (polling.current || pending.current || !ref.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!online()) return;
    polling.current = true;
    refresh()
      .then(() => setErr((e) => (e?.source === 'read' ? null : e)))
      .catch((e) => setErr(readError(e)))
      .finally(() => { polling.current = false; });
  }, [refresh]);

  useEffect(() => {
    const on = () => {
      setIsOnline(true);
      setErr((e) => (e?.code === 'offline' ? null : e));
      poll();
    };
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [poll]);

  useEffect(() => {
    polling.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the shared workspace from the server on first render
    refresh()
      .catch((e) => setErr(readError(e)))
      .finally(() => { polling.current = false; setLoading(false); });

    // The poll pauses while the tab is hidden or offline, and never overlaps a poll or a save in flight.
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => poll();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, poll]);

  const signOut = async () => {
    if (pending.current) return;
    let response: Response;
    try {
      response = await fetch('/api/session', {
        method: 'DELETE',
        headers: { 'x-halqa-csrf': ref.current?.csrf ?? '' },
      });
    } catch {
      setErr({ code: 'network', text: ERROR_TEXT.network, canRetry: false, source: 'write' });
      return;
    }
    if (!response.ok && response.status !== 401) {
      setErr({ code: 'signOut', text: ERROR_TEXT.signOut, canRetry: false, source: 'write' });
      return;
    }
    clearSession();
  };

  /** Clears the selection and shows "This patient is not on your list". */
  const leaveCase = useCallback(() => {
    const current = ref.current;
    if (current) apply({ ...current, state: { ...current.state, selectedId: null } }, false);
    setNotOnList(true);
  }, [apply]);

  const executeAction = useCallback(
    (a: Action, replay?: { requestId: string; revision: number | null }) => {
      const current = ref.current;
      if (!current) return;

      if (localActions.includes(a.type)) {
        const s = { ...current.state };
        if (a.type === 'SELECT') s.selectedId = a.id;
        if (a.type === 'VIEW') {
          if (current.user.person.role === 'PATIENT' && a.view !== 'patient') return;
          s.view = a.view;
        }
        if (a.type === 'PATIENT_CASE') s.patientCaseId = a.id;
        if (a.type === 'SELECT' || a.type === 'VIEW') setNotOnList(false);
        apply({ ...current, state: s }, false);
        return;
      }

      if (['ROLE', 'SET_PLAYING', 'RESET', 'LOAD', 'DISMISS_TOAST'].includes(a.type)) {
        setErr({ code: 'refused', text: 'Sign in with the appropriate account. Shared records cannot be reset or impersonated.', canRetry: false, source: 'write' });
        return;
      }

      if (!online()) {
        setErr({ code: 'offline', text: ERROR_TEXT.offline, canRetry: false, source: 'write' });
        return;
      }

      pending.current++;
      setBusy(true);
      const userId = current.user.id;
      const generation = epoch.current;
      const requestId = replay?.requestId ?? crypto.randomUUID();

      queue.current = queue.current
        .then(async () => {
          const latest = ref.current;
          if (!latest || latest.user.id !== userId || generation !== epoch.current) return;
          // A retry sends the original request id and revision, so the server's receipt recognises it.
          const revision = replay?.revision ?? latest.revision;
          lastFailed.current = { action: a, requestId, revision };

          let response: Response;
          try {
            response = await fetch('/api/workspace', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-halqa-csrf': latest.csrf },
              body: JSON.stringify({ requestId, revision, action: a }),
            });
          } catch {
            if (generation === epoch.current) setErr({ code: 'network', text: ERROR_TEXT.network, canRetry: true, source: 'write' });
            return;
          }
          if (generation !== epoch.current) return;
          let data: (Snapshot & { error?: string }) | null = null;
          try { data = await response.json(); } catch { data = null; }
          if (generation !== epoch.current) return;

          if (response.status === 401) { clearSession(); return; }
          if (response.ok && data) {
            lastFailed.current = null;
            apply(data);
            setErr(null);
            return;
          }
          const serverText = typeof data?.error === 'string' ? data.error : '';
          if (response.ok || !data) {
            setErr({ code: 'unconfirmed', text: ERROR_TEXT.unconfirmed, canRetry: true, source: 'write' });
            return;
          }
          if (response.status === 404) {
            lastFailed.current = null;
            await refresh().catch(() => undefined);
            if (generation !== epoch.current) return;
            if (ref.current?.user.person.role === 'PATIENT') {
              setErr({ code: 'refused', text: serverText || ERROR_TEXT.refused, canRetry: false, source: 'write' });
            } else {
              leaveCase();
            }
            return;
          }
          if (response.status === 409) {
            await refresh().catch(() => undefined);
            if (generation !== epoch.current) return;
            if ((ref.current?.revision ?? revision) > revision) {
              // Someone saved first. Show the latest record; a retry is a new request on it.
              lastFailed.current = { action: a, requestId: crypto.randomUUID(), revision: null };
              setErr({ code: 'stale', text: ERROR_TEXT.stale, canRetry: true, source: 'write' });
            } else {
              lastFailed.current = null;
              setErr({ code: 'refused', text: serverText || ERROR_TEXT.refused, canRetry: false, source: 'write' });
            }
            return;
          }
          if (response.status >= 500) {
            setErr({ code: 'save', text: ERROR_TEXT.save, canRetry: true, source: 'write' });
            return;
          }
          lastFailed.current = null;
          setErr({ code: 'refused', text: serverText || ERROR_TEXT.refused, canRetry: false, source: 'write' });
        })
        .finally(() => {
          pending.current--;
          setBusy(pending.current > 0);
        });
    },
    [apply, refresh, clearSession, leaveCase],
  );

  const d: React.Dispatch<Action> = useCallback((a: Action) => { executeAction(a); }, [executeAction]);

  const retry = useCallback(() => {
    const failed = lastFailed.current;
    const fromWrite = err?.source === 'write';
    setErr(null);
    if (fromWrite && failed) {
      executeAction(failed.action, { requestId: failed.requestId, revision: failed.revision });
    } else {
      refresh().catch((e) => setErr(readError(e)));
    }
  }, [err, executeAction, refresh]);

  const dismissError = useCallback(() => setErr(null), []);
  const laterArrival = useCallback(() => setArrivals((q) => q.slice(1)), []);
  const openArrival = useCallback(() => {
    const first = arrivals[0];
    setArrivals((q) => q.slice(1));
    if (first) executeAction({ type: 'SELECT', id: first.id });
  }, [arrivals, executeAction]);
  const leaveNotOnList = useCallback(() => {
    setNotOnList(false);
    executeAction({ type: 'SELECT', id: null });
  }, [executeAction]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <div className="w-full max-w-[480px] rounded-card border border-slate-200 bg-white p-8">
          <div className="flex items-center gap-2 mb-6" aria-label="Halqa">
            <span aria-hidden="true" className="h-7 w-7 rounded-full bg-teal-700" />
            <span className="text-[20px] font-bold text-slate-900">Halqa</span>
          </div>
          <div aria-hidden="true" className="space-y-4">
            <div className="h-6 w-3/4 rounded-full bg-slate-200 animate-pulse" />
            <div className="h-4 w-full rounded-full bg-slate-200 animate-pulse" />
            <div className="h-4 w-5/6 rounded-full bg-slate-200 animate-pulse" />
            <div className="h-12 w-full rounded-button bg-slate-200 animate-pulse mt-6" />
          </div>
          <p className="mt-5 text-center text-[15px] font-medium text-slate-500">Connecting to Halqa…</p>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <SignIn
        error={err?.text ?? ''}
        onSignIn={async (email, password) => {
          setErr(null);
          let response: Response;
          try {
            response = await fetch('/api/session', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, password }),
            });
          } catch {
            throw new Error(ERROR_TEXT.network);
          }
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : ERROR_TEXT.network);
          clearSession();
          await refresh().catch((e) => setErr(readError(e)));
        }}
      />
    );
  }

  return (
    <StoreCtx.Provider
      value={{
        s: snapshot.state,
        d,
        user: snapshot.user,
        directory: snapshot.directory,
        patient: snapshot.patient,
        csrf: snapshot.csrf,
        isOnline,
        testControls: snapshot.testControls,
        busy,
        error: err?.text ?? '',
        errorCode: err?.code ?? null,
        canRetry: !!err?.canRetry,
        retry,
        dismissError,
        arrivals,
        openArrival,
        laterArrival,
        notOnList,
        leaveNotOnList,
        refresh,
        signOut,
      }}
    >
      {children}
    </StoreCtx.Provider>
  );
}

export function useHalqa() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useHalqa outside provider');
  return ctx;
}

export function useCase(id: string | null) {
  const { s } = useHalqa();
  return id ? s.cases.find((c) => c.id === id) ?? null : null;
}

/** Whether a change can be saved right now, and the plain reason when it cannot. */
export function useCanSave(): { ok: boolean; reason: string; code: 'offline' | 'busy' | null } {
  const { isOnline, busy } = useHalqa();
  if (!isOnline) return { ok: false, reason: 'You are offline', code: 'offline' };
  if (busy) return { ok: false, reason: 'Saving your last change', code: 'busy' };
  return { ok: true, reason: '', code: null };
}

export { currentStep };
