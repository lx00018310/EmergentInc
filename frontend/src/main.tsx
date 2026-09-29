import React from 'react';
import ReactDOM from 'react-dom/client';
import { OwnerEntry } from './OwnerEntry';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <OwnerEntry />
  </React.StrictMode>
);
