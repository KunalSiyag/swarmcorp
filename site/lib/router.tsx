import { useEffect, useSyncExternalStore } from 'react';

// A tiny history router: the site has a handful of routes, so no dependency is needed.
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); window.addEventListener('popstate', l); return () => { listeners.delete(l); window.removeEventListener('popstate', l); }; };

export function navigate(to: string) {
  if (to === location.pathname + location.hash) return;
  history.pushState(null, '', to);
  listeners.forEach((l) => l());
  const hash = to.split('#')[1];
  requestAnimationFrame(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo({ top: 0 });
  });
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function Link({ to, className, children, ...rest }: { to: string; className?: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={to} className={className} {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || /^https?:/.test(to)) return;
        e.preventDefault();
        navigate(to);
      }}>
      {children}
    </a>
  );
}

export function useTitle(title: string) {
  useEffect(() => { document.title = title; }, [title]);
}
