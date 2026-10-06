'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export type PanelFigure = {
  label: string;
  value: string;
  /** 'pos-text' / 'neg-text' / '' */
  tone?: string;
};

const KEY = 'sipwise:collapsed:';
const read = (id: string) => {
  try {
    return localStorage.getItem(KEY + id) === '1';
  } catch {
    return false;
  }
};
const write = (id: string, collapsed: boolean) => {
  try {
    if (collapsed) localStorage.setItem(KEY + id, '1');
    else localStorage.removeItem(KEY + id);
  } catch {
    // Storage can be blocked; the panel still works for this visit.
  }
};

/**
 * A panel that folds down to one line. While folded the header keeps the figures a dashboard needs (value, gain and
 * so on), so nothing important disappears. The folded state is remembered per panel in this browser only.
 */
export default function CollapsiblePanel({
  id,
  title,
  badge,
  figures,
  actions,
  ariaLabel,
  className,
  children,
}: {
  id: string;
  title: string;
  badge?: string;
  figures: PanelFigure[];
  /** Buttons shown on the right while the panel is open. */
  actions?: ReactNode;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => read(id));
  const bodyId = `panel-body-${id}`;
  return (
    <section
      className={`panel collapsible${collapsed ? ' is-collapsed' : ''}${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel ?? title}
    >
      <div className="collapsible__head">
        <button
          type="button"
          className="collapsible__toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => {
            setCollapsed(!collapsed);
            write(id, !collapsed);
          }}
        >
          <ChevronDown
            size={18}
            aria-hidden="true"
            className="collapsible__chevron"
          />
          <span className="collapsible__title">{title}</span>
          {badge && <span className="count-badge">{badge}</span>}
        </button>
        {collapsed ? (
          <dl className="collapsible__figures">
            {figures.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd className={`amount ${f.tone ?? ''}`}>{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          actions && <div className="collapsible__actions">{actions}</div>
        )}
      </div>
      {!collapsed && (
        <div id={bodyId} className="collapsible__body">
          {children}
        </div>
      )}
    </section>
  );
}
