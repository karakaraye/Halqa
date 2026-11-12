'use client';
/**
 * Receiving services for the clinic lead: the units that accept referrals.
 * A section of the Accounts screen. The server decides what is allowed; this screen lists, adds and disables.
 */
import React, { useCallback, useEffect, useId, useState } from 'react';
import { useHalqa } from '@/context/HalqaStore';
import type { PathwayId } from '@/types/halqa';
import { PATHWAYS } from '@/lib/pathways';
import {
  Button, Card, Chip, Dialog, Empty, Field, Input, Loading, Notice, SaveButton, Select,
} from '@/components/design/primitives';
import { callServer } from '@/components/design/request';

export interface ServiceSummary {
  id: string;
  facility: string;
  specialty: string;
  pathway: PathwayId;
  specialistUserId: string;
  specialistName: string;
  disabled: boolean;
}

const PATHWAY_IDS = Object.keys(PATHWAYS) as PathwayId[];
const LOAD_FAILED = 'We could not load the receiving services. Please try again.';
const CREATE_FAILED = 'We could not add this service. Please try again.';
const DISABLE_FAILED = 'We could not disable this service. Please try again.';
const CREATE_STATUS: Record<number, string> = {
  409: 'This unit already has a service for that programme.',
  422: 'Check the details. The specialist must be an active specialist account.',
};

export function ServicesSection() {
  const { csrf, refresh } = useHalqa();
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [toDisable, setToDisable] = useState<ServiceSummary | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await callServer<{ services?: ServiceSummary[] }>('/api/admin/services', { cache: 'no-store' }, LOAD_FAILED);
      setServices(data.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list from the server when the section opens
    void load();
  }, [load]);

  /** After a change: reload the list, and the snapshot so doctors' referral choices follow. */
  const changed = async () => {
    await load();
    await refresh().catch(() => undefined);
  };

  const addButton = (
    <Button kind="primary" onClick={() => setShowAdd(true)}>Add a receiving service</Button>
  );
  const emptyList = !loading && !error && services.length === 0;

  return (
    <section aria-labelledby="services-title" className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 id="services-title" className="text-page-title text-slate-900">Receiving services</h1>
          <p className="mt-2 text-body text-slate-700">
            These are the units that accept referrals. A doctor can only send a referral to a service listed here.
          </p>
        </div>
        {!emptyList && addButton}
      </header>

      {error && (
        <Notice
          tone="error"
          title={error}
          action={<Button kind="secondary" onClick={() => void load()}>Try again</Button>}
        />
      )}

      {loading ? (
        <Loading label="Loading receiving services…" />
      ) : emptyList ? (
        <Empty title="No receiving services yet" text="Doctors cannot send referrals until you add one." action={addButton} />
      ) : (
        <ul className="space-y-4">
          {services.map((s) => (
            <li key={s.id}>
              <Card as="article" aria-label={`${s.facility}, ${PATHWAYS[s.pathway]?.short ?? s.pathway}`} className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-[20px] leading-7 font-semibold text-slate-900">{s.facility}</h2>
                    {s.disabled ? <Chip tone="slate" dot>Disabled</Chip> : <Chip tone="teal" dot>Active</Chip>}
                  </div>
                  <p className="mt-1 text-[16px] text-slate-700">{PATHWAYS[s.pathway]?.short ?? s.pathway} · {s.specialty}</p>
                  <p className="mt-1 text-[16px] text-slate-700">Answered by {s.specialistName || 'a specialist who is no longer listed'}</p>
                </div>
                {!s.disabled && (
                  <Button kind="secondary" aria-label={`Disable ${s.facility}, ${PATHWAYS[s.pathway]?.short ?? s.pathway}`} onClick={() => setToDisable(s)}>
                    Disable
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {showAdd && (
        <Dialog title="Add a receiving service" onClose={() => setShowAdd(false)}>
          <AddServiceForm
            csrf={csrf}
            onCancel={() => setShowAdd(false)}
            onAdded={() => { setShowAdd(false); void changed(); }}
          />
        </Dialog>
      )}

      {toDisable && (
        <DisableDialog
          service={toDisable}
          csrf={csrf}
          onCancel={() => setToDisable(null)}
          onDone={() => { setToDisable(null); void changed(); }}
        />
      )}
    </section>
  );
}

function AddServiceForm({ csrf, onAdded, onCancel }: { csrf: string; onAdded: () => void; onCancel: () => void }) {
  const { directory } = useHalqa();
  const id = useId();
  const specialists = directory.people.filter((p) => p.role === 'SPECIALIST');
  const [facility, setFacility] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [pathway, setPathway] = useState('');
  const [specialist, setSpecialist] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPending(true);
    try {
      await callServer('/api/admin/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-halqa-csrf': csrf },
        body: JSON.stringify({ facility: facility.trim(), specialty: specialty.trim(), pathway, specialistUserId: specialist }),
      }, CREATE_FAILED, CREATE_STATUS);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : CREATE_FAILED);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name of the unit" htmlFor={`${id}-facility`} hint="The name doctors will see when they choose where to refer.">
        <Input id={`${id}-facility`} required minLength={2} maxLength={160} value={facility} onChange={(e) => setFacility(e.target.value)} />
      </Field>
      <Field label="Specialty" htmlFor={`${id}-specialty`} hint="The kind of care this unit gives, in a few words.">
        <Input id={`${id}-specialty`} required minLength={2} maxLength={120} value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
      </Field>
      <Field label="Care programme" htmlFor={`${id}-pathway`} hint="Doctors only see this service for patients in this programme.">
        <Select id={`${id}-pathway`} required value={pathway} onChange={(e) => setPathway(e.target.value)}>
          <option value="">Choose a programme</option>
          {PATHWAY_IDS.map((p) => <option key={p} value={p}>{PATHWAYS[p].short}</option>)}
        </Select>
      </Field>
      {specialists.length === 0 ? (
        <Notice tone="warn" title="Add a specialist account first (People tab), then come back here." />
      ) : (
        <Field label="Specialist who answers" htmlFor={`${id}-specialist`} hint="This person receives and answers the referrals.">
          <Select id={`${id}-specialist`} required value={specialist} onChange={(e) => setSpecialist(e.target.value)}>
            <option value="">Choose a specialist</option>
            {specialists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      )}

      {error && (
        <p role="alert" className="rounded-input bg-rose-50 px-4 py-3 text-[14px] font-medium text-rose-700">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-3">
        <Button kind="quiet" onClick={onCancel} disabled={pending}>Cancel</Button>
        <SaveButton type="submit" kind="primary" disabled={pending || specialists.length === 0}>
          {pending ? 'Adding…' : 'Add service'}
        </SaveButton>
      </div>
    </form>
  );
}

function DisableDialog({ service, csrf, onCancel, onDone }: { service: ServiceSummary; csrf: string; onCancel: () => void; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const disable = async () => {
    setError('');
    setPending(true);
    try {
      await callServer(`/api/admin/services/${service.id}/disable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-halqa-csrf': csrf },
        body: '{}',
      }, DISABLE_FAILED);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : DISABLE_FAILED);
      setPending(false);
    }
  };

  return (
    <Dialog
      title="Disable this service?"
      onClose={onCancel}
      footer={(
        <>
          <Button kind="quiet" onClick={onCancel} disabled={pending}>Not now</Button>
          <SaveButton kind="danger" disabled={pending} onClick={() => void disable()}>
            {pending ? 'Disabling…' : 'Disable service'}
          </SaveButton>
        </>
      )}
    >
      <p className="text-[16px] text-slate-700">
        New referrals to <strong>{service.facility}</strong> will be refused. Referrals already sent stay as they are.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-input bg-rose-50 px-4 py-3 text-[14px] font-medium text-rose-700">{error}</p>
      )}
    </Dialog>
  );
}
