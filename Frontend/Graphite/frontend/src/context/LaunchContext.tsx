import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const LOADER_DURATION_MS = 2500;

interface LaunchContextValue {
  isLaunching: boolean;
  launch: () => void;
}

const LaunchContext = createContext<LaunchContextValue | null>(null);

export function LaunchProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => {
    timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const launch = useCallback(() => {
    if (isLaunching) return;
    setIsLaunching(true);
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      const t = window.setTimeout(() => {
        navigate('/repos');
        setIsLaunching(false);
      }, 600);
      timers.current.push(t);
      return;
    }
    const t1 = window.setTimeout(() => {
      navigate('/repos');
    }, LOADER_DURATION_MS + 200);
    const t2 = window.setTimeout(() => {
      setIsLaunching(false);
    }, LOADER_DURATION_MS + 200 + 300);
    timers.current.push(t1, t2);
  }, [isLaunching, navigate]);

  // cleanup on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // (timers cleaned via effect below)
  return (
    <LaunchContext.Provider value={{ isLaunching, launch }}>
      {children}
    </LaunchContext.Provider>
  );
}

export function useLaunchApp() {
  const ctx = useContext(LaunchContext);
  if (!ctx) throw new Error('useLaunchApp must be used within LaunchProvider');
  return ctx;
}