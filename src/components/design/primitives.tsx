'use client';
/**
 * Halqa design primitives (Figma: Foundations, node 10:2).
 * Plain words, big text, one main button per screen, and colour that always comes with a word.
 */
import React, { useEffect, useId, useRef } from 'react';
import { useCanSave } from '@/context/HalqaStore';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ Button */

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'success' | 'quiet';

const buttonKinds: Record<ButtonKind, string> = {
  primary: 'bg-teal-700 text-white border-2 border-teal-700 hover:bg-teal-800 hover:border-teal-800',
  secondary: 'bg-white text-teal-800 border-2 border-teal-700 hover:bg-teal-50',
  danger: 'bg-rose-600 text-white border-2 border-rose-600 hover:brightness-95',
  success: 'bg-emerald-600 text-white border-2 border-emerald-600 hover:brightness-95',
  quiet: 'bg-slate-100 text-slate-900 border-2 border-slate-100 hover:bg-slate-200 hover:border-slate-200',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind;
  size?: 'md' | 'lg';
  full?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = 'primary', size = 'md', full, className, type = 'button', disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-button font-semibold transition-colors',
        size === 'lg' ? 'min-h-[56px] px-6 text-[18px]' : 'min-h-[48px] px-5 text-[16px]',
        full && 'w-full',
        disabled
          ? 'bg-slate-200 text-slate-500 border-2 border-slate-200 cursor-not-allowed'
          : buttonKinds[kind],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/**
 * A button that saves to the shared record. It is turned off while offline or while a save is
 * in flight, and says why (as its tooltip and accessible description). Patient screens pass
 * their translator for the reason.
 */
export const SaveButton = React.forwardRef<HTMLButtonElement, ButtonProps & { tr?: (key: string) => string }>(function SaveButton(
  { disabled, tr, title, ...rest },
  ref,
) {
  const reason = useSaveBlock(tr);
  const descId = useId();
  return (
    <>
      <Button
        ref={ref}
        {...rest}
        disabled={disabled || !!reason}
        title={reason || title}
        aria-describedby={reason ? descId : rest['aria-describedby']}
      />
      {reason && <span id={descId} className="sr-only">{reason}</span>}
    </>
  );
});

/** The reason saving is not possible right now ('' when it is), translated when `tr` is given. */
export function useSaveBlock(tr?: (key: string) => string) {
  const save = useCanSave();
  if (save.ok) return '';
  if (!tr) return save.reason;
  return tr(save.code === 'offline' ? 'offlineReason' : 'savingReason');
}

/* -------------------------------------------------------------------- Chip */

export type Tone = 'rose' | 'amber' | 'emerald' | 'teal' | 'sky' | 'violet' | 'slate';

const chipTones: Record<Tone, { box: string; dot: string }> = {
  rose: { box: 'bg-rose-50 text-rose-600', dot: 'bg-rose-600' },
  amber: { box: 'bg-amber-50 text-amber-600', dot: 'bg-amber-600' },
  emerald: { box: 'bg-emerald-50 text-emerald-600', dot: 'bg-emerald-600' },
  teal: { box: 'bg-teal-50 text-teal-800', dot: 'bg-teal-700' },
  sky: { box: 'bg-sky-50 text-sky-600', dot: 'bg-sky-600' },
  violet: { box: 'bg-violet-50 text-violet-600', dot: 'bg-violet-600' },
  slate: { box: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
};

export function Chip({ tone = 'slate', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  const t = chipTones[tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-semibold leading-5 whitespace-nowrap', t.box, className)}>
      {dot && <span aria-hidden="true" className={cx('h-2 w-2 rounded-full', t.dot)} />}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- Card */

const cardTones = {
  white: 'bg-white border-slate-200',
  teal: 'bg-teal-50 border-teal-100',
  rose: 'bg-rose-50 border-rose-50',
  amber: 'bg-amber-50 border-amber-50',
  sky: 'bg-sky-50 border-sky-50',
} as const;

export function Card({
  tone = 'white', as: Tag = 'section', className, children, ...rest
}: { tone?: keyof typeof cardTones; as?: React.ElementType; className?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx('rounded-card border p-6', cardTones[tone], className)} {...rest}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ Fields */

/**
 * A label, an optional hint and one control. The hint is tied to the control with aria-describedby,
 * so a screen reader reads it with the field. The control must have the id given as `htmlFor`.
 */
export function Field({ label, hint, htmlFor, className, children }: { label: React.ReactNode; hint?: React.ReactNode; htmlFor: string; className?: string; children: React.ReactNode }) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const joined = (own: unknown) => [typeof own === 'string' ? own : '', hintId].filter(Boolean).join(' ') || undefined;
  const content = React.Children.map(children, (child) => {
    if (!hintId || !React.isValidElement<{ id?: string; 'aria-describedby'?: string }>(child) || child.props.id !== htmlFor) return child;
    return React.cloneElement(child, { 'aria-describedby': joined(child.props['aria-describedby']) });
  });
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <label htmlFor={htmlFor} className="text-[14px] font-semibold text-slate-900">{label}</label>
      {hint && <p id={hintId} className="text-[14px] text-slate-500 -mt-1">{hint}</p>}
      {content}
    </div>
  );
}

const control = 'w-full rounded-input border border-slate-400 bg-white px-4 text-[16px] text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(control, 'min-h-[48px]', className)} {...rest} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(control, 'min-h-[96px] py-3', className)} {...rest} />;
});

/** `large` makes the control 56 px high, as on the patient screens. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { large?: boolean }>(function Select({ className, children, large, ...rest }, ref) {
  return <select ref={ref} className={cx(control, large ? 'min-h-[56px]' : 'min-h-[48px]', 'pr-10', className)} {...rest}>{children}</select>;
});

/* ------------------------------------------------------------------ Avatar */

const avatarTones: Record<'teal' | 'amber' | 'slate', string> = {
  teal: 'bg-teal-100 text-teal-800',
  amber: 'bg-amber-50 text-amber-600',
  slate: 'bg-slate-100 text-slate-700',
};

export function Avatar({ initials, tone = 'teal', size = 48, label }: { initials: string; tone?: keyof typeof avatarTones; size?: number; label?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size }}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-[16px]', avatarTones[tone])}
    >
      {initials}
    </span>
  );
}

export function initialsOf(name: string) {
  const words = name.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/* ------------------------------------------------------------------ Dialog */

const focusable = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({ title, children, footer, onClose }: { title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; onClose: () => void }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = box.current;
    const first = node?.querySelector<HTMLElement>(focusable);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(focusable)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); node.focus(); return; }
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === head || document.activeElement === node)) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-[640px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-dialog bg-white p-6 sm:p-8 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-[24px] leading-8 font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-button text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
          </button>
        </div>
        <div className="mt-4 text-[16px] text-slate-700">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Notice */

const noticeTones = {
  error: { box: 'bg-rose-50 border-rose-600/30', title: 'text-rose-600', role: 'alert' as const },
  warn: { box: 'bg-amber-50 border-amber-600/30', title: 'text-amber-600', role: 'status' as const },
  info: { box: 'bg-sky-50 border-sky-600/30', title: 'text-sky-600', role: 'status' as const },
  success: { box: 'bg-emerald-50 border-emerald-600/30', title: 'text-emerald-600', role: 'status' as const },
};

export function Notice({ tone = 'info', title, text, action, className }: { tone?: keyof typeof noticeTones; title: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const t = noticeTones[tone];
  return (
    <div role={t.role} className={cx('flex flex-wrap items-center gap-4 rounded-card border px-6 py-4', t.box, className)}>
      <div className="min-w-0 flex-1">
        <p className={cx('text-[16px] font-semibold', t.title)}>{title}</p>
        {text && <p className="mt-1 text-[14px] text-slate-700">{text}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------- Empty / Loading / Skeleton */

export function Empty({ title, text, action }: { title: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="flex flex-col items-center text-center py-12">
      <p className="text-[18px] font-semibold text-slate-900">{title}</p>
      {text && <p className="mt-2 max-w-md text-[16px] text-slate-500">{text}</p>}
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}

export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['w-full', 'w-11/12', 'w-3/4', 'w-5/6', 'w-2/3'];
  return (
    <div aria-hidden="true" className={cx('space-y-3', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cx('h-4 rounded-full bg-slate-200 animate-pulse', widths[i % widths.length])} />
      ))}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Card role="status" aria-live="polite">
      <Skeleton lines={3} />
      <p className="mt-4 text-[14px] text-slate-500">{label}</p>
    </Card>
  );
}
