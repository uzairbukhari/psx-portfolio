'use client';
import { useEffect, useState } from 'react';

export type DirectoryCompany = { ticker: string; name: string; sector: string };

// The directory is public and small (about 500 listed companies), so it is fetched once per page load and searched
// on the device: results appear as you type, with no request per keystroke.
let cache: DirectoryCompany[] | null = null;
let inflight: Promise<DirectoryCompany[]> | null = null;

function load(): Promise<DirectoryCompany[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= fetch('/api/companies/search?all=1')
    .then(async (response) => {
      if (!response.ok) throw Error('The PSX company list could not be loaded.');
      const body = (await response.json()) as { companies?: DirectoryCompany[] };
      cache = body.companies ?? [];
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useDirectory(): { companies: DirectoryCompany[]; loading: boolean; error: string } {
  const [companies, setCompanies] = useState<DirectoryCompany[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState('');
  useEffect(() => {
    if (cache) return;
    let live = true;
    load()
      .then((list) => live && (setCompanies(list), setLoading(false)))
      .catch((e: unknown) => live && (setError(e instanceof Error ? e.message : 'Could not load companies.'), setLoading(false)));
    return () => {
      live = false;
    };
  }, []);
  return { companies, loading, error };
}

/** Ranks exact symbol, then symbol prefix, then name-word prefix, then any substring. */
export function searchCompanies(list: DirectoryCompany[], query: string, limit = 30): DirectoryCompany[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [number, DirectoryCompany][] = [];
  for (const company of list) {
    const ticker = company.ticker.toLowerCase();
    const name = company.name.toLowerCase();
    const score =
      ticker === q ? 0 : ticker.startsWith(q) ? 1 : name.startsWith(q) || name.includes(` ${q}`) ? 2 : ticker.includes(q) || name.includes(q) ? 3 : sectorHit(company, q) ? 4 : -1;
    if (score >= 0) scored.push([score, company]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].ticker.localeCompare(b[1].ticker)).slice(0, limit).map(([, company]) => company);
}
const sectorHit = (company: DirectoryCompany, q: string) => company.sector.toLowerCase().includes(q);
