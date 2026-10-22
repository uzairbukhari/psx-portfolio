import { LandingFooter, LandingNav } from '../landing/landing-chrome';
import { CfBeacon } from '../cf-beacon';
import { edgeCached } from '@/lib/edge-cache';

export const metadata = {
  title: 'Get the Android app | Sipwise',
  description: 'Download the Sipwise Android app (APK) and install it on your phone.',
};

const REPO = 'uzairbukhari/psx-portfolio';
const RELEASES = `https://github.com/${REPO}/releases`;

type Download = { version: string; apk: string; sizeMb: number; sha256Url: string | null } | null;

type Release = { tag_name: string; prerelease: boolean; draft: boolean; assets: { name: string; browser_download_url: string; size: number }[] };

/** The newest promoted Android build (the in-app updater's rule), or the newest pre-release while none is promoted. */
async function latestApk(): Promise<Download> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'sipwise-download-page' },
    });
    if (!res.ok) return null;
    const releases = (await res.json()) as Release[];
    // Promoted builds first (what the in-app updater offers); until one exists, the newest pre-release.
    const android = releases.filter((r) => !r.draft && r.tag_name.startsWith('android-v'));
    for (const r of [...android.filter((x) => !x.prerelease), ...android.filter((x) => x.prerelease)]) {
      const apk = r.assets.find((a) => /^sipwise-\d[^/]*\.apk$/.test(a.name));
      if (!apk) continue;
      const sums = r.assets.find((a) => a.name === 'SHA256SUMS');
      return {
        version: r.tag_name.replace('android-v', ''),
        apk: apk.browser_download_url,
        sizeMb: Math.round((apk.size / 1024 / 1024) * 10) / 10,
        sha256Url: sums?.browser_download_url ?? null,
      };
    }
  } catch {
    // The page still works with the plain releases link.
  }
  return null;
}

export default async function Page() {
  const latest = await edgeCached<Download>('android-latest-apk', 600, latestApk, undefined, undefined, (v) => v !== null);
  return (
    <main className="landing">
      <CfBeacon />
      <LandingNav />
      <article className="lp-legal">
        <h1>Get the Android app</h1>
        <p className="updated">
          {latest ? `Version ${latest.version} · ${latest.sizeMb} MB · Android 8 or newer` : 'Android 8 or newer'}
        </p>
        <p>
          Sipwise for Android is not on Google Play. You install it directly from a file, and the app then keeps itself
          up to date.
        </p>
        <div className="dl-card">
          <a className="dl-btn" href={latest?.apk ?? `${RELEASES}/latest`}>
            {latest ? 'Download the APK' : 'Open the latest release'}
          </a>
          <p>{latest ? `Sipwise ${latest.version} for Android` : 'Pick the file named sipwise-<version>.apk'}</p>
        </div>
        <h2>Install it</h2>
        <ol>
          <li>Open this page on your phone and tap Download. If Chrome warns that the file may be harmful, choose Download anyway.</li>
          <li>Open the downloaded file. Android asks you to allow installs from your browser: turn it on for this one install.</li>
          <li>If Play Protect shows a notice, choose More details, then Install anyway. The app is signed by its developer but is not in Play&rsquo;s catalogue.</li>
          <li>Open Sipwise, sign in with Google and unlock your vault with the same password as on the web.</li>
        </ol>
        <h2>Updates</h2>
        <p>
          When a new version is released the app offers it when you open it. You can also use{' '}
          <a href="https://github.com/ImranR98/Obtainium">Obtainium</a> and point it at{' '}
          <a href={RELEASES}>{`github.com/${REPO}`}</a> to update automatically.
        </p>
        <h2>Check the file</h2>
        <p>
          {latest?.sha256Url ? (
            <>
              The <a href={latest.sha256Url}>SHA256SUMS</a> file lists the checksum of every download.{' '}
            </>
          ) : null}
          All builds are listed on <a href={RELEASES}>GitHub Releases</a>.
        </p>
        <p>
          iPhone: use the web app in Safari and choose Share, then Add to Home Screen. Questions:{' '}
          <a href="mailto:support@sipwise.trade">support@sipwise.trade</a>.
        </p>
      </article>
      <LandingFooter />
    </main>
  );
}
