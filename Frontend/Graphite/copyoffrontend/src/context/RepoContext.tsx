import { createContext, useContext, useState } from 'react';
import type { Repo } from '../api/types';

type Ctx = { selectedRepoId: string | null; setSelectedRepoId: (id: string | null) => void; selectedRepo: Repo | null; setSelectedRepo: (r: Repo | null) => void };
const RepoContext = createContext<Ctx>({ selectedRepoId: null, setSelectedRepoId: () => {}, selectedRepo: null, setSelectedRepo: () => {} });
export const useRepo = () => useContext(RepoContext);
export function RepoProvider({ children }: { children: React.ReactNode }) {
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  return <RepoContext.Provider value={{ selectedRepoId, setSelectedRepoId, selectedRepo, setSelectedRepo }}>{children}</RepoContext.Provider>;
}
