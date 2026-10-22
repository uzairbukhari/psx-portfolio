'use client';
// Help: short answers, shortcuts and the policy links, in a sheet that opens from the profile menu (desktop) or More
// (phone). The tour, checklist and tips are added to the "Get started" group as they are built.
import { useEffect, useState } from 'react';
import {
  BookOpen,
  Keyboard,
  MessageSquareText,
  PlayCircle,
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { HELP_FAQ, HELP_SHORTCUTS } from '@/lib/help-content';
import { track } from './analytics';

/** True on a phone-width screen, where the sheet rises from the bottom instead of the side. */
function usePhoneWidth() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(max-width:760px)');
    const update = () => setPhone(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  return phone;
}

export function HelpPanel({
  open,
  onOpenChange,
  onTour,
  onChecklist,
  checklistNote,
  onTips,
  onFeedback,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Replays the tour. Left out where there is nothing to point at yet (an empty account). */
  onTour?: () => void;
  /** Brings the Getting started card back to Holdings; `note` is its progress ("3 of 6 done"). */
  onChecklist?: () => void;
  checklistNote?: string;
  /** Shows the one-time page tips again. */
  onTips?: () => void;
  /** Opens the Contact us / Report an issue / Suggest a feature page. */
  onFeedback?: () => void;
}) {
  const phone = usePhoneWidth();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        className="help-panel"
        aria-label="Help"
      >
        <SheetHeader>
          <SheetTitle className="help-title">Help</SheetTitle>
          <SheetDescription>Quick answers about Sipwise.</SheetDescription>
        </SheetHeader>
        <div className="help-body">
          {(onTour || onChecklist || onTips) && (
            <section aria-labelledby="help-start">
              <h3 id="help-start" className="help-h">
                <PlayCircle size={14} aria-hidden="true" /> Get started
              </h3>
              {onTour && (
                <button
                  type="button"
                  data-slot="help-row"
                  className="help-row"
                  onClick={() => {
                    track('help_opened', { item: 'tour' });
                    onTour();
                  }}
                >
                  <b>Take the tour</b>
                  <small>Where everything lives · about a minute</small>
                </button>
              )}
              {onChecklist && (
                <button
                  type="button"
                  data-slot="help-row"
                  className="help-row"
                  onClick={() => {
                    track('help_opened', { item: 'checklist' });
                    onChecklist();
                  }}
                >
                  <b>Getting started checklist</b>
                  <small>
                    {checklistNote ? `${checklistNote} · ` : ''}Show it on
                    Holdings
                  </small>
                </button>
              )}
              {onTips && (
                <button
                  type="button"
                  data-slot="help-row"
                  className="help-row"
                  onClick={() => {
                    track('help_opened', { item: 'tips' });
                    onTips();
                  }}
                >
                  <b>Show page tips again</b>
                  <small>The one-time notes at the top of each page</small>
                </button>
              )}
            </section>
          )}
          <section aria-labelledby="help-faq">
            <h3 id="help-faq" className="help-h">
              <BookOpen size={14} aria-hidden="true" /> How Sipwise works
            </h3>
            <Accordion
              onValueChange={(v) =>
                v.length > 0 && track('help_opened', { item: 'faq' })
              }
            >
              {HELP_FAQ.map((q) => (
                <AccordionItem key={q.id} value={q.id}>
                  <AccordionTrigger>{q.question}</AccordionTrigger>
                  <AccordionContent>
                    <p className="help-answer">{q.answer}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
          <section aria-labelledby="help-keys" className="help-keys-section">
            <h3 id="help-keys" className="help-h">
              <Keyboard size={14} aria-hidden="true" /> Shortcuts
            </h3>
            <ul className="help-keys">
              {HELP_SHORTCUTS.map((s) => (
                <li key={s.keys}>
                  <kbd className="help-kbd">{s.keys}</kbd> {s.label}
                </li>
              ))}
            </ul>
          </section>
          {onFeedback && (
            <section aria-labelledby="help-contact">
              <h3 id="help-contact" className="help-h">
                <MessageSquareText size={14} aria-hidden="true" /> Still stuck?
              </h3>
              <button
                type="button"
                data-slot="help-row"
                className="help-row"
                onClick={onFeedback}
              >
                <b>Contact us, report an issue or suggest a feature</b>
                <small>Write to us from inside the app</small>
              </button>
            </section>
          )}
        </div>
        <nav className="help-foot" aria-label="Legal">
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            onClick={() => track('help_opened', { item: 'privacy' })}
          >
            Privacy
          </a>
          <a
            href="/terms"
            target="_blank"
            rel="noreferrer"
            onClick={() => track('help_opened', { item: 'terms' })}
          >
            Terms
          </a>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
