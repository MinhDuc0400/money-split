import { io, Socket } from 'socket.io-client';

const BASE = process.env.EXPO_PUBLIC_API_URL!;
let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (!socket) {
    socket = io(`${BASE}/events`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
