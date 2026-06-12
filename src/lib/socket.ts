import { io, type Socket } from 'socket.io-client'
import { supabase } from './supabase'

/**
 * Connection to the dedicated socket.io chat server (realtime-server/).
 * Configured via VITE_SOCKET_URL; when it's not set or the server is asleep,
 * the app keeps working over Supabase realtime — this is the fast path,
 * not a requirement.
 */
const url = (import.meta.env.VITE_SOCKET_URL as string | undefined)?.trim()

let socket: Socket | null = null

export function getSocket(): Socket | null {
  if (!url) return null
  if (socket) return socket
  socket = io(url, {
    transports: ['websocket'],
    // fresh token on every (re)connect, so expired sessions reconnect cleanly
    auth: (cb) => {
      supabase.auth.getSession().then(({ data }) => cb({ token: data.session?.access_token ?? '' }))
    },
  })
  return socket
}

export function closeSocket() {
  socket?.disconnect()
  socket = null
}
