import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ShareView from './components/ShareView.tsx';
import { decodeSession } from './lib/exports.ts';
import './index.css';

function Root() {
  const encoded = new URLSearchParams(window.location.hash.slice(1)).get('share');
  if (encoded) {
    try {
      return <ShareView session={decodeSession(encoded)} />;
    } catch {
      console.warn('Failed to decode shared debate from URL hash.');
    }
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Root /></StrictMode>
);
