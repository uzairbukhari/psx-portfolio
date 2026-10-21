'use client';
// The first-visit tour: a spotlight on a real element (found by data-tour="…"), a popover with the step's copy, and an
// offer card that asks first. Non-modal for assistive tech: the page stays in the accessibility tree, the popover is a
// labelled dialog that takes focus, Esc skips, the arrow keys move. Steps whose element is not on screen are skipped.
import { useCallback, useEffect, useRef, useState } from 'react';
import { stepsToShow, type TourStep, type TourStepId } from '@/lib/tour-steps';
import { track } from './analytics';

type Box = { left: number; top: number; width: number; height: number };

function findTarget(id: TourStepId): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

const PAD = 6;
const GAP = 14;
const EDGE = 12;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Where the popover goes on a wide screen: beside the target if it fits, else below, else above, else inside it. */
function placePopover(t: Box, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const right = t.left + t.width + GAP;
  if (right + w <= vw - EDGE) return { left: right, top: clamp(t.top, EDGE, vh - h - EDGE) };
  const below = t.top + t.height + GAP;
  if (below + h <= vh - EDGE) return { left: clamp(t.left, EDGE, vw - w - EDGE), top: below };
  const above = t.top - GAP - h;
  if (above >= EDGE) return { left: clamp(t.left, EDGE, vw - w - EDGE), top: above };
  return { left: clamp(t.left + t.width - w - 24, EDGE, vw - w - EDGE), top: clamp(t.top + t.height - h - 24, EDGE, vh - h - EDGE) };
}

function useReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ProductTour({
  source,
  onClose,
}: {
  source: 'auto' | 'help';
  onClose: (outcome: 'completed' | 'skipped', atStep: TourStepId) => void;
}) {
  const [steps] = useState<TourStep[]>(() =>
    stepsToShow(
      (id) => !!findTarget(id),
      (href) => !!document.querySelector(`nav[aria-label="Main"] a[href="${href}"]`),
    ),
  );
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null);
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width:760px)').matches);
  const popRef = useRef<HTMLDialogElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();
  const step = steps[index];
  const last = index === steps.length - 1;

  const close = useCallback(
    (outcome: 'completed' | 'skipped') => onClose(outcome, steps[index]?.id ?? 'value'),
    [onClose, steps, index],
  );

  // Start: remember focus, pin an unpinned sidebar open while the tour runs, report.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const side = document.documentElement.dataset.side;
    if (side && side !== 'pinned') document.documentElement.dataset.side = 'pinned';
    track('tour_started', { source });
    return () => {
      if (side && side !== 'pinned') document.documentElement.dataset.side = side;
      opener?.focus?.({ preventScroll: true });
    };
  }, [source]);

  // Nothing to point at (an empty account, a narrow layout): end quietly.
  useEffect(() => {
    if (steps.length === 0) onClose('skipped', 'value');
  }, [steps, onClose]);

  // Each step: report it, bring the element into view, move focus to the popover heading.
  useEffect(() => {
    if (!step) return;
    track('tour_step_viewed', { step: step.id });
    findTarget(step.id)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    headRef.current?.focus({ preventScroll: true });
  }, [step, reduce]);

  // Follow the element (scrolling, resizing, the sidebar finishing its animation) with one cheap frame loop.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let prev = '';
    const tick = () => {
      const el = findTarget(step.id);
      const pw = popRef.current?.offsetWidth ?? 340;
      const ph = popRef.current?.offsetHeight ?? 200;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (el) {
        const r = el.getBoundingClientRect();
        const left = Math.max(r.left - PAD, 4);
        const top = Math.max(r.top - PAD, 4);
        const b: Box = {
          left,
          top,
          width: Math.min(r.right + PAD, vw - 4) - left,
          height: Math.min(r.bottom + PAD, vh - 4) - top,
        };
        const key = `${b.left}|${b.top}|${b.width}|${b.height}|${pw}|${ph}|${vw}|${vh}`;
        if (key !== prev) {
          prev = key;
          setBox(b);
          setPop(placePopover(b, pw, ph, vw, vh));
          setPhone(window.matchMedia('(max-width:760px)').matches);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // Keys: Esc skips, arrows move, Tab stays inside the popover.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close('skipped');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (last) close('completed');
        else setIndex((i) => i + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Tab' && popRef.current) {
        const items = [...popRef.current.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
        if (!items.length) return;
        const first = items[0];
        const lastEl = items[items.length - 1];
        const active = document.activeElement;
        if (!popRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && (active === first || active === headRef.current)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && active === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, last]);

  if (!step || !box) return null;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  // On a phone the card spans the width, above the bottom bar, or at the top when the target sits low.
  const phoneStyle =
    box.top + box.height / 2 > vh * 0.55 ? { top: 64 } : { bottom: 'calc(92px + env(safe-area-inset-bottom))' };
  const style = phone ? { left: 14, right: 14, ...phoneStyle } : pop ? { left: pop.left, top: pop.top } : { visibility: 'hidden' as const };

  return (
    <div className="tour-root" data-reduce={reduce || undefined}>
      <div className="tour-block" aria-hidden="true" />
      <div className="tour-spot" aria-hidden="true" style={box} />
      <dialog
        open
        ref={popRef}
        className="tour-pop"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={style}
      >
        <p className="tour-step">
          Step {index + 1} of {steps.length}
        </p>
        <h3 id="tour-title" ref={headRef} tabIndex={-1}>
          {step.title}
        </h3>
        <div id="tour-body" className="tour-copy">
          {step.body && <p>{step.body}</p>}
          {step.items && (
            <ul>
              {step.items.map((i) => (
                <li key={i.name}>
                  <b>{i.name}</b> · {i.text}
                </li>
              ))}
            </ul>
          )}
          {(phone ? step.phoneNote : step.note) && <p className="tour-note">{phone ? step.phoneNote : step.note}</p>}
        </div>
        <div className="tour-act">
          <span className="tour-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <i key={s.id} data-on={i === index || undefined} />
            ))}
          </span>
          {index > 0 && (
            <button type="button" data-slot="tour-btn" className="tour-btn tour-btn--ghost" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            data-slot="tour-btn"
            className="tour-btn"
            onClick={() => (last ? close('completed') : setIndex(index + 1))}
          >
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
        <button type="button" data-slot="tour-skip" className="tour-skip" onClick={() => close('skipped')}>
          Skip tour
        </button>
      </dialog>
      <div className="sr-only" aria-live="polite">
        Step {index + 1} of {steps.length}: {step.title}
      </div>
    </div>
  );
}

/** Asks first. Waits until no dialog or sheet is open, so it never lands on top of something the person is doing. */
export function TourOffer({ onStart, onDecline }: { onStart: () => void; onDecline: () => void }) {
  const [quiet, setQuiet] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      setQuiet(!document.querySelector('[role="dialog"], [role="alertdialog"]'));
    }, 900);
    return () => window.clearInterval(id);
  }, []);
  const shown = useRef(false);
  useEffect(() => {
    if (!quiet) return;
    if (!shown.current) {
      shown.current = true;
      track('tour_offered');
    }
    startRef.current?.focus({ preventScroll: true });
  }, [quiet]);
  useEffect(() => {
    if (!quiet) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDecline();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [quiet, onDecline]);
  if (!quiet) return null;
  return (
    <div className="tour-root">
      <div className="tour-block tour-block--dim" aria-hidden="true" />
      <dialog open className="tour-offer" aria-labelledby="tour-offer-title" aria-describedby="tour-offer-body">
        <p className="tour-offer-kicker">✓ Your portfolio is live</p>
        <h3 id="tour-offer-title">Now the rest of Sipwise opens up</h3>
        <p id="tour-offer-body">Take a 1-minute look at where everything lives: adding, your pages, dividends and settings.</p>
        <div className="tour-act">
          <button ref={startRef} type="button" data-slot="tour-btn" className="tour-btn tour-btn--lg" onClick={onStart}>
            Show me around
          </button>
          <button type="button" data-slot="tour-btn" className="tour-btn tour-btn--ghost" onClick={onDecline}>
            Not now
          </button>
        </div>
        <small>6 short steps · Esc skips at any time · Replay it from Help</small>
      </dialog>
    </div>
  );
}
