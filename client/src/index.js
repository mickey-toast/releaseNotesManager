import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import AuthGate from './AuthGate';
import { PermissionsProvider } from './permissionsContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthGate>
      <PermissionsProvider>
        <App />
      </PermissionsProvider>
    </AuthGate>
  </React.StrictMode>
);

