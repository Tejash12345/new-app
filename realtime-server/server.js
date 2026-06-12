// FocusLion realtime chat server — socket.io
//
// Auth: clients connect with their Supabase access token; we verify it
// against Supabase Auth, so nobody can pretend to be someone else.
// Messages are persisted by the web app through Supabase (RLS enforced);
// this server only relays them instantly between connected users.

import { createServer } from 'http'
import { Server } from 'socket.io'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hgnbgnzgciooifwyfbgn.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_ayNbzdRu6Utt4BN3Zhc_lg_mnQuIJV0'
const PORT = process.env.PORT || 3001

// userId -> Set of connected socket ids (a user can have several tabs/devices)
const online = new Map()

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, service: 'focuslion-realtime', online: online.size }))
})

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

// verify the Supabase JWT before letting a socket in
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('missing token'))
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return next(new Error('invalid token'))
    const user = await r.json()
    if (!user?.id) return next(new Error('invalid token'))
    socket.data.userId = user.id
    next()
  } catch {
    next(new Error('auth failed'))
  }
})

io.on('connection', (socket) => {
  const uid = socket.data.userId
  socket.join(`user:${uid}`)

  const sockets = online.get(uid) ?? new Set()
  sockets.add(socket.id)
  online.set(uid, sockets)
  if (sockets.size === 1) io.emit('presence:online', uid)
  socket.emit('presence:list', [...online.keys()])

  // direct message: relay to the recipient (and the sender's other devices)
  socket.on('dm', (msg) => {
    if (!msg || msg.sender_id !== uid || !msg.recipient_id || typeof msg.body !== 'string') return
    io.to(`user:${msg.recipient_id}`).emit('dm', msg)
    socket.to(`user:${uid}`).emit('dm', msg)
  })

  socket.on('dm:del', (p) => {
    if (!p?.id || !p?.to) return
    io.to(`user:${p.to}`).emit('dm:del', { id: p.id, from: uid })
  })

  socket.on('typing', (p) => {
    if (!p?.to) return
    io.to(`user:${p.to}`).emit('typing', { from: uid })
  })

  // community rooms
  socket.on('room:join', (room) => {
    if (typeof room === 'string' && room.length <= 40) socket.join(`room:${room}`)
  })
  socket.on('room:leave', (room) => {
    if (typeof room === 'string') socket.leave(`room:${room}`)
  })
  socket.on('room:msg', (p) => {
    if (!p?.room || !p?.msg || p.msg.user_id !== uid) return
    socket.to(`room:${p.room}`).emit('room:msg', p.msg)
  })

  socket.on('disconnect', () => {
    const s = online.get(uid)
    if (!s) return
    s.delete(socket.id)
    if (s.size === 0) {
      online.delete(uid)
      io.emit('presence:offline', uid)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`🦁 FocusLion realtime server listening on :${PORT}`)
})
