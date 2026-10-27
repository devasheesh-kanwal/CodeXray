import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ApiError } from './api/client';
import './index.css';

// Retry once when the backend is unreachable; API errors (409, 503, ...) are shown right away.
const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => err instanceof ApiError && err.status === 0 && count < 1 },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
