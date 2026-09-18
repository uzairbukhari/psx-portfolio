// Replaces the old Mac helper's local companies/<TICKER> archive: builds a
// zip client-side from whatever the in-browser runner fetched during a run.
import { zipSync, strToU8 } from 'fflate';
import { getRunArchive } from './research-runner';

export function downloadRunSources(jobId: string) {
  const archive = getRunArchive(jobId);
  if (!archive) return false;
  const files: Record<string, Uint8Array> = {
    'RESEARCH.md': strToU8(archive.dossierMarkdown),
  };
  for (const item of archive.documents) {
    if (!item.bytes) continue;
    const name = item.title.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80) || 'report';
    files[`reports/${name}.pdf`] = item.bytes;
    if (item.text) files[`extracted/${name}.txt`] = strToU8(item.text);
  }
  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${archive.ticker}-research-sources.zip`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
  return true;
}
