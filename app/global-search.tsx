'use client';
// The top search bar: as you type it lists matching companies (yours first, then the PSX directory), funds, gold and
// silver, currency and savings plans; choosing one opens its page. The directory is public data, and only the typed
// text is sent.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { KIND_LABEL, searchItems, type SearchItem } from '@/lib/global-search';

type Hit = { ticker: string; name: string; sector?: string };

export default function GlobalSearch({
  items,
  onPick,
}: {
  items: SearchItem[];
  onPick: (item: SearchItem) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [directory, setDirectory] = useState<{ q: string; hits: Hit[] }>({
    q: '',
    hits: [],
  });
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      fetch(`/api/companies/search?q=${encodeURIComponent(q)}`)
        .then((r) =>
          r.ok
            ? (r.json() as Promise<{ companies?: Hit[] }>)
            : { companies: [] },
        )
        .then((body) => live && setDirectory({ q, hits: body.companies ?? [] }))
        .catch(() => live && setDirectory({ q, hits: [] }));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  const results = useMemo(() => {
    const fromDirectory: SearchItem[] =
      directory.q === q
        ? directory.hits.map((h) => ({
            kind: 'company',
            key: h.ticker,
            label: h.name,
            sub: [h.ticker, h.sector].filter(Boolean).join(' · '),
          }))
        : [];
    return searchItems([...items, ...fromDirectory], q);
  }, [items, directory, q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const choose = (item: SearchItem) => {
    setOpen(false);
    setQuery('');
    onPick(item);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const showPanel = open && q.length > 0;
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  return (
    <div className="hdr-search-wrap" ref={root}>
      <label className="hdr-search">
        <Search size={15} aria-hidden="true" />
        <input
          id="global-search"
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showPanel && results.length ? `${listId}-${activeIndex}` : undefined
          }
          autoComplete="off"
          value={query}
          placeholder="Search companies, funds, gold"
          aria-label="Search companies, funds and assets"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && showPanel && results[activeIndex]) {
              e.preventDefault();
              choose(results[activeIndex]);
            }
          }}
        />
        <kbd>Ctrl K</kbd>
      </label>
      {showPanel && (
        <div
          className="search-panel"
          id={listId}
          role="listbox"
          aria-label="Search results"
        >
          {results.length === 0 ? (
            <p className="search-empty">
              {q.length < 2 ? 'Keep typing…' : `Nothing matches “${q}”.`}
            </p>
          ) : (
            results.map((item, i) => (
              <div key={`${item.kind}:${item.key}`}>
                {(i === 0 || results[i - 1].kind !== item.kind) && (
                  <span className="search-group">{KIND_LABEL[item.kind]}</span>
                )}
                <button
                  type="button"
                  data-slot="search-result"
                  role="option"
                  id={`${listId}-${i}`}
                  aria-selected={i === activeIndex}
                  className={i === activeIndex ? 'on' : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  <b>{item.label}</b>
                  <small>{item.sub}</small>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
