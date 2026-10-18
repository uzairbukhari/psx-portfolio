'use client';
// The month picker the Plan page keeps in the top bar. Separate from plan-page.tsx so the dashboard shell can import it
// without pulling the lazy Plan chunk into the main bundle.
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ''} ${m.slice(0, 4)}`;

const shiftMonth = (m: string, by: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function PlanMonthNav({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  return (
    <div className="plan-month-nav">
      <small>Monthly SIP</small>
      <div className="plan-month">
        <button type="button" data-slot="icon" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft size={16} />
        </button>
        <b>{monthName(month)}</b>
        <button type="button" data-slot="icon" className="icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
