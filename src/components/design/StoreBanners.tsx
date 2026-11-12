'use client';
/**
 * The store's banners: offline, could not save (with "Try again" when it is safe) and new results.
 * Staff see the English text; the patient portal passes its translator so patients read them in their language.
 */
import React from 'react';
import { useHalqa, type ErrorCode } from '@/context/HalqaStore';

const PATIENT_ERROR_KEY: Record<ErrorCode, string> = {
  network: 'errNetwork',
  unconfirmed: 'errUnconfirmed',
  stale: 'errStale',
  save: 'errSave',
  refused: 'errRefused',
  offline: 'errOffline',
  signOut: 'errSignOut',
  load: 'errLoad',
};

export function StoreBanners({ tr }: { tr?: (key: string) => string }) {
  const { isOnline, error, errorCode, canRetry, retry, dismissError, arrivals, openArrival, laterArrival } = useHalqa();
  const say = (key: string, english: string) => (tr ? tr(key) : english);
  const errorText = errorCode && tr ? tr(PATIENT_ERROR_KEY[errorCode]) : error;
  const next = tr ? undefined : arrivals[0];
  const touch = tr ? 'min-h-[56px]' : 'min-h-[48px]'; // 56 px on the patient screens

  return (
    <>
      {!isOnline && (
        <div
          role="status"
          className="sticky top-0 z-[105] flex items-center bg-amber-50 border-b border-amber-600 text-slate-900 px-4 py-3 text-[16px]"
        >
          <span className="flex-1 font-medium">
            {say('offlineBanner', 'You are offline. Halqa will reconnect automatically when your connection returns.')}
          </span>
        </div>
      )}

      {errorText && (
        <div
          role="alert"
          className="sticky top-0 z-[100] flex flex-wrap gap-3 items-center bg-rose-50 border-b border-rose-600 text-slate-900 px-4 py-3 text-[16px]"
        >
          <span className="flex-1 font-medium">{errorText}</span>
          {canRetry && (
            <button
              type="button"
              className={`${touch} rounded-button bg-white border-2 border-teal-700 px-4 font-semibold text-teal-800`}
              onClick={retry}
            >
              {say('tryAgain', 'Try again')}
            </button>
          )}
          <button
            type="button"
            aria-label={say('dismiss', 'Dismiss error')}
            className={`${touch} min-w-[48px] px-3 font-semibold text-slate-700`}
            onClick={dismissError}
          >
            ✕
          </button>
        </div>
      )}

      {next && (
        <div
          role="status"
          className="sticky top-0 z-[95] flex flex-wrap gap-3 items-center bg-teal-50 border-b border-teal-700 text-slate-900 px-4 py-3 text-[16px]"
        >
          <span className="flex-1 font-medium">
            New result for <strong>{next.name}</strong>. Open it?
            {arrivals.length > 1 && (
              <span className="block text-[14px] font-normal text-slate-700">
                {arrivals.length - 1 === 1 ? '1 more new result after this one.' : `${arrivals.length - 1} more new results after this one.`}
              </span>
            )}
          </span>
          <button
            type="button"
            className={`${touch} rounded-button bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800`}
            onClick={openArrival}
          >
            Open
          </button>
          <button
            type="button"
            className={`${touch} rounded-button border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-50`}
            onClick={laterArrival}
          >
            Later
          </button>
        </div>
      )}
    </>
  );
}
