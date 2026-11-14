import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { SearchProvider } from './state/SearchContext';
import SearchPage from './pages/SearchPage';
import ResultsPage from './pages/ResultsPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SearchProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </SearchProvider>
  </StrictMode>,
);
