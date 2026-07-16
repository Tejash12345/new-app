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
  // No URL configured (the default) → socket.io is OFF and the whole app runs
  // on Supabase realtime, which is free and already carries DMs/typing/watch-
  // together/calls. Set VITE_SOCKET_URL only if you have a LIVE socket server.
  if (!url) return null
  if (socket) return socket
  socket = io(url, {
    transports: ['websocket'],
    // give up quickly + quietly if the server is down/suspended so a dead host
    // can never hang the app or spam reconnects — Supabase realtime takes over
    reconnectionAttempts: 3,
    reconnectionDelayMax: 8000,
    timeout: 5000,
    auth: (cb) => {
      supabase.auth.getSession().then(({ data }) => cb({ token: data.session?.access_token ?? '' }))
    },
  })
  // swallow connection errors — they're expected when the server is asleep/down
  socket.on('connect_error', () => { /* fall back to Supabase realtime */ })
  return socket
}

export function closeSocket() {
  socket?.disconnect()
  socket = null
}
