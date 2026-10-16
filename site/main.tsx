import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';

// Routes prerendered at build time (scripts/site-routes.mjs) arrive with their HTML: hydrate it.
// The rest (/thanks, 404) arrive empty and render on the client.
const root = document.getElementById('root')!;
const app = <StrictMode><App /></StrictMode>;
if (root.firstElementChild) hydrateRoot(root, app);
else createRoot(root).render(app);
