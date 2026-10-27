import { createContext, useContext, useState } from 'react';
import type { Repo } from '../api/types';

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
  const [selectedRepoId, setSelectedRepoIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('codexray_selected_repo_id');
    } catch {
      return null;
    }
  });
  const [selectedRepo, setSelectedRepoState] = useState<Repo | null>(null);

  const setSelectedRepoId = (id: string | null) => {
    setSelectedRepoIdState(id);
    try {
      if (id) {
        localStorage.setItem('codexray_selected_repo_id', id);
      } else {
        localStorage.removeItem('codexray_selected_repo_id');
      }
    } catch {}
  };

  const setSelectedRepo = (r: Repo | null) => {
    if (r) {
      const normalized: Repo = {
        ...r,
        id: r.id || (r as any).repo_id,
        repo_id: (r as any).repo_id || r.id,
      };
      setSelectedRepoState(normalized);
      if (normalized.id && !selectedRepoId) {
        setSelectedRepoId(normalized.id);
      }
    } else {
      setSelectedRepoState(null);
    }
  };

  return (
    <RepoContext.Provider value={{ selectedRepoId, setSelectedRepoId, selectedRepo, setSelectedRepo }}>
      {children}
    </RepoContext.Provider>
  );
}

