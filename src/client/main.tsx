import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setNonce } from 'get-nonce';
import App from './App';
import './styles.css';
import './workbench.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
const styleNonce = document.querySelector<HTMLMetaElement>('meta[name="csp-style-nonce"]')?.content;
if (styleNonce) setNonce(styleNonce);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
