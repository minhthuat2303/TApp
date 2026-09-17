import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import syncEngine, { SyncEngine } from './SyncEngine';
import { SyncStatus } from './types';

interface SyncContextType {
  syncStatus: SyncStatus;
  pendingCount: number;
  conflictCount: number;
  isSyncing: boolean;
  triggerSync: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

interface SyncProviderProps {
  children: ReactNode;
  engine?: SyncEngine;
}

export const SyncProvider: React.FC<SyncProviderProps> = ({ children, engine = syncEngine }) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(engine.getStatus());
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [conflictCount, setConflictCount] = useState<number>(0);

  const isSyncing = syncStatus === 'SYNCING';

  const refresh = useCallback(async () => {
    const status = await engine.refreshStatus();
    setSyncStatus(status);
  }, [engine]);

  const triggerSync = useCallback(async () => {
    await engine.sync({ manual: true });
  }, [engine]);

  useEffect(() => {
    // Initial status refresh
    refresh();

    // Subscribe to engine state notifications
    const unsubscribe = engine.addListener((status, stats) => {
      setSyncStatus(status);
      setPendingCount(stats.pendingCount);
      setConflictCount(stats.conflictCount);
    });

    return () => {
      unsubscribe();
    };
  }, [engine, refresh]);

  return (
    <SyncContext.Provider
      value={{
        syncStatus,
        pendingCount,
        conflictCount,
        isSyncing,
        triggerSync,
        refreshStatus: refresh,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = (): SyncContextType => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
};

export default SyncContext;
