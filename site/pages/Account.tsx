import { ArrowUpRight } from 'lucide-react';
import { Cmd, PlateHead } from '../components/Chrome.tsx';
import { Link, useTitle } from '../lib/router.tsx';
import { SITE } from '../config.ts';

/** Where buyers recover keys and invoices. SwarmCorp keeps no accounts; Dodo's billing portal is the record. */
export default function Account() {
  useTitle('Your licence · SwarmCorp');
  const rows: [string, string, React.ReactNode][] = [
    ['01', 'Find your licence key', <>Open the billing portal and enter the email you paid with. You'll get a sign-in link: no password, nothing to remember. Your key is listed with the purchase.</>],
    ['02', 'Download invoices', <>The same portal lists every payment, with an invoice you can download for expenses.</>],
    ['03', 'Activate on a machine', <>Run <code className="font-mono text-ink">swarmcorp open</code>, click <span className="text-ink">Free</span> in the top bar, paste the key and press <span className="text-ink">Activate Pro</span>. One key works on up to 3 machines.</>],
    ['04', 'Move to a new machine', <>On the old machine, open <span className="text-ink">Settings → Licence → Deactivate</span>. That frees a slot. Then activate on the new one.</>],
    ['05', 'Back it up', <>Once activated, <span className="text-ink">Settings → Licence → Reveal key / Save as file</span> gives you a copy at any time.</>],
  ];
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6">
      <PlateHead as="h1" n="—" kicker="Your licence" title="Lost your key? It's not lost.">
        SwarmCorp has no accounts. Your purchase, licence key and invoices live in the Dodo Payments billing portal, under the email you paid with.
      </PlateHead>
      <div className="md:ml-[196px]">
        <a href={SITE.dodoPortalUrl} target="_blank" rel="noreferrer"
          className="mb-12 inline-flex items-center gap-2 bg-signal px-5 py-3 font-mono text-[12px] font-semibold tracking-[0.14em] text-void uppercase hover:brightness-110">
          Open billing portal <ArrowUpRight size={14} />
        </a>
        <ol className="border-t border-line">
          {rows.map(([n, t, b]) => (
            <li key={n} className="grid gap-2 border-b border-line py-6 md:grid-cols-[90px_240px_1fr] md:gap-6">
              <span className="display num text-[30px] leading-none text-ink-3">{n}</span>
              <h2 className="text-[19px] font-bold">{t}</h2>
              <p className="max-w-xl text-[15px] leading-relaxed text-ink-2">{b}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 max-w-xl space-y-3">
          <div className="hud">Check what your dashboard sees</div>
          <Cmd cmd="swarmcorp status" />
        </div>
        <p className="mt-10 font-mono text-[12px] text-ink-3">
          Not bought yet? <Link to="/#pricing" className="text-ink underline decoration-signal underline-offset-4">See pricing</Link>.
          {' '}Something wrong with a purchase? <a href="https://github.com/KunalSiyag/swarmcorp/issues" target="_blank" rel="noreferrer" className="text-ink underline decoration-signal underline-offset-4">Open an issue</a> with your payment reference.
        </p>
      </div>
    </main>
  );
}
