import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link, useTitle } from '../lib/router.tsx';
import { Cmd } from '../components/Chrome.tsx';

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
              <p className="mt-3 font-mono text-[11px] text-ink-3">Keep it somewhere safe. You can move it between machines with Deactivate in Settings.</p>
            </div>
          )}
          <ol className="space-y-4 border-t border-line pt-6 text-[15px] text-ink-2">
            <li><span className="num mr-3 text-ink-3">01</span>Start the dashboard if it isn't running.<div className="mt-2 max-w-xl"><Cmd cmd="npm start -- --project ~/code/your-app" /></div></li>
            <li><span className="num mr-3 text-ink-3">02</span>Open <span className="text-ink">http://localhost:4317</span> and click <span className="text-ink">Free</span> in the top bar.</li>
            <li><span className="num mr-3 text-ink-3">03</span>Paste the key under Licence and press <span className="text-ink">Activate Pro</span>.</li>
          </ol>
          <p className="mt-10 font-mono text-[12px] text-ink-3">Payment reference: {q.get('payment_id') ?? '—'} · <Link to="/docs/pro" className="underline decoration-signal underline-offset-4">How Pro works</Link></p>
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
