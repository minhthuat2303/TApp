import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import networkService from './NetworkService';

interface NetworkContextType {
  isConnected: boolean;
  isInternetReachable: boolean;
  isServerReachable: boolean;
  isOnline: boolean;
  recheckServer: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextType>({
  isConnected: true,
  isInternetReachable: true,
  isServerReachable: false,
  isOnline: true,
  recheckServer: async () => false,
});

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState<boolean>(networkService.getIsConnected());
  const [isInternetReachable, setIsInternetReachable] = useState<boolean>(networkService.getIsInternetReachable());
  const [isServerReachable, setIsServerReachable] = useState<boolean>(false);

  const recheckServer = useCallback(async () => {
    const reachable = await networkService.checkServerReachability();
    setIsServerReachable(reachable);
    return reachable;
  }, []);

  useEffect(() => {
    const unsubscribe = networkService.addListener((connected) => {
      setIsConnected(connected);
      setIsInternetReachable(networkService.getIsInternetReachable());
      if (connected) {
        recheckServer();
      } else {
        setIsServerReachable(false);
      }
    });

    // Check on startup
    recheckServer();

    return () => unsubscribe();
  }, [recheckServer]);

  const isOnline = isConnected && isInternetReachable;

  return (
    <NetworkContext.Provider
      value={{
        isConnected,
        isInternetReachable,
        isServerReachable,
        isOnline,
        recheckServer,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = (): NetworkContextType => useContext(NetworkContext);
export default NetworkContext;
