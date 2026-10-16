import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { usePath } from './lib/router.tsx';
import { Footer, Nav } from './components/Chrome.tsx';
import Landing, { PricingSection } from './pages/Landing.tsx';
import { BlogIndex, BlogPost, DocPage, NotFound, SinglePage } from './pages/Reading.tsx';

function Route() {
  const path = usePath().replace(/\/+$/, '') || '/';
  if (path === '/') return <Landing />;
  if (path === '/pricing') return <main><PricingSection /></main>;
  if (path === '/blog') return <BlogIndex />;
  if (path.startsWith('/blog/')) return <BlogPost slug={path.slice(6)} />;
  if (path === '/docs') return <DocPage slug="getting-started" />;
  if (path.startsWith('/docs/')) return <DocPage slug={path.slice(6)} />;
  if (path === '/tips') return <SinglePage slug="tips" />;
  if (path === '/changelog') return <SinglePage slug="changelog" />;
  return <NotFound />;
}

function App() {
  return (
    <>
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-signal focus:px-3 focus:py-2 focus:text-void">Skip to content</a>
      <Nav />
      <div id="content"><Route /></div>
      <Footer />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
