import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link, useTitle } from '../lib/router.tsx';
import { Cmd } from '../components/Chrome.tsx';
import { SITE } from '../config.ts';

function saveKeys(keys: string[]) {
  const text = `SwarmCorp Pro licence key${keys.length > 1 ? 's' : ''}\n${keys.join('\n')}\n\nActivate: swarmcorp open → Free → Licence → Activate Pro.\nLost it? ${SITE.dodoPortalUrl}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  Object.assign(document.createElement('a'), { href: url, download: 'swarmcorp-licence.txt' }).click();
  URL.revokeObjectURL(url);
}

/** Dodo Payments redirects here after checkout with payment_id, status, email and license_key in the query. */
export default function Thanks() {
  useTitle('Thanks · SwarmCorp Pro');
  const q = new URLSearchParams(location.search);
  const status = q.get('status');
  const email = q.get('email');
  const keys = (q.get('license_key') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const ok = status === 'succeeded' || (!status && keys.length > 0);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-[900px] px-4 py-20 sm:px-6">
      <div className="hud mb-4">Plate · Receipt</div>
      {ok ? (
        <>
          <h1 className="display balance mb-4 text-[clamp(40px,6vw,76px)]">You're Pro. <span className="glow">Thank you.</span></h1>
          <p className="mb-10 max-w-xl text-[17px] text-ink-2">
            Your payment went through{email ? <> and a copy of your key is on its way to <span className="text-ink">{email}</span></> : null}. Activate it in the dashboard: it takes ten seconds.
          </p>
          {keys.length > 0 && (
            <div className="frame mb-10 p-5" data-active="true">
              <div className="hud mb-3">Your licence key</div>
              {keys.map((k) => (
                <div key={k} className="mb-2 flex items-stretch border border-line-2 bg-void">
                  <code className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5 font-mono text-[14px] whitespace-nowrap">{k}</code>
                  <button type="button" aria-label="Copy key" className="border-l border-line-2 px-3 text-ink-3 hover:text-ink"
                    onClick={() => navigator.clipboard?.writeText(k).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1200); }).catch(() => {})}>
                    {copied === k ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              ))}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => saveKeys(keys)} className="border border-line-2 px-3 py-1.5 font-mono text-[11px] tracking-widest uppercase hover:border-ink-3">Save as file</button>
                <span className="font-mono text-[11px] text-ink-3">Works on up to 3 machines. Move it with Deactivate in Settings.</span>
              </div>
            </div>
          )}
          <ol className="space-y-4 border-t border-line pt-6 text-[15px] text-ink-2">
            <li><span className="num mr-3 text-ink-3">01</span>Start the dashboard if it isn't running, then open it.<div className="mt-2 max-w-xl space-y-2"><Cmd cmd="swarmcorp start --project ~/code/your-app" /><Cmd cmd="swarmcorp open" /></div></li>
            <li><span className="num mr-3 text-ink-3">02</span>In the dashboard, click <span className="text-ink">Free</span> in the top bar to open Settings.</li>
            <li><span className="num mr-3 text-ink-3">03</span>Paste the key under Licence and press <span className="text-ink">Activate Pro</span>.</li>
          </ol>
          <div className="frame mt-10 p-5">
            <div className="hud mb-2">Lost it later?</div>
            <p className="text-[15px] text-ink-2">
              Your key and invoices always live in the billing portal. Sign in with the email you paid with. There's nothing to remember and no password.
            </p>
            <a href={SITE.dodoPortalUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block bg-signal px-4 py-2 font-mono text-[11px] font-semibold tracking-widest text-void uppercase">Open billing portal ↗</a>
          </div>
          <p className="mt-6 font-mono text-[12px] text-ink-3">Payment reference: {q.get('payment_id') ?? '—'} · <Link to="/docs/pro" className="underline decoration-signal underline-offset-4">How Pro works</Link></p>
        </>
      ) : (
        <>
          <h1 className="display mb-4 text-[clamp(40px,6vw,76px)]">Payment not completed.</h1>
          <p className="mb-8 max-w-xl text-[17px] text-ink-2">
            {status ? <>The checkout returned status <span className="text-ink">{status}</span>. You were not charged for a completed purchase.</> : <>This page appears after checkout.</>} You can try again from the pricing section.
          </p>
          <Link to="/#pricing" className="bg-signal px-5 py-3 font-mono text-[12px] font-semibold tracking-[0.14em] text-void uppercase">Back to pricing</Link>
        </>
      )}
    </main>
  );
}
