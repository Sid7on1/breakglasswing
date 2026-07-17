import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// QA/debug: ?static freezes all animation/transitions so screenshot tooling sees an idle,
// fully-painted page.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('static')) {
  document.documentElement.classList.add('qa-static');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
