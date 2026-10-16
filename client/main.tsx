import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import SwarmDashboard from './SwarmDashboard.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SwarmDashboard />
  </StrictMode>,
);
