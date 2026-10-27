import { createContext, useCallback, useContext, useState } from 'react';
import type { Repo } from '../api/types';

const STORAGE_KEY = 'codexray_selected_repo_id';

type Ctx = {
  selectedRepoId: string | null;
  setSelectedRepoId: (id: string | null) => void;
  selectedRepo: Repo | null;
  setSelectedRepo: (r: Repo | null) => void;
};

const RepoContext = createContext<Ctx>({
  selectedRepoId: null,
  setSelectedRepoId: () => {},
  selectedRepo: null,
  setSelectedRepo: () => {},
});

export const useRepo = () => useContext(RepoContext);

export function RepoProvider({ children }: { children: React.ReactNode }) {
  // The selected repo survives a page reload (per-browser convenience only).
  const [selectedRepoId, setIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [selectedRepo, setSelectedRepoState] = useState<Repo | null>(null);

  const setSelectedRepoId = useCallback((id: string | null) => {
    setIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable (private window); the selection just won't persist
    }
  }, []);

  const setSelectedRepo = useCallback((r: Repo | null) => setSelectedRepoState(r), []);

  return (
    <RepoContext.Provider value={{ selectedRepoId, setSelectedRepoId, selectedRepo, setSelectedRepo }}>
      {children}
    </RepoContext.Provider>
  );
}
