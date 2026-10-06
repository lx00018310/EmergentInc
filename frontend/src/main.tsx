import React from 'react';
import ReactDOM from 'react-dom/client';
import { Entry } from './Entry';
import { language } from './i18n';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

document.documentElement.lang = language();
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Entry />
  </React.StrictMode>
);
