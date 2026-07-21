import { useEffect } from 'react';
import { useAppSelector } from '../store/hooks';
import { getSocket, disconnectSocket } from '../lib/socket';

export function SocketManager() {
  const token = useAppSelector((s) => s.auth.token);

  useEffect(() => {
    if (token) {
      getSocket(token);
    } else {
      disconnectSocket();
    }
  }, [token]);

  return null;
}
