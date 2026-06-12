import { useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { Button, Input } from '../components/ui'

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name } },
        })
        if (error) throw error
        setMsg({ kind: 'ok', text: 'Account created! Check your email to confirm, then log in.' })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err: unknown) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="aurora flex min-h-screen items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass-strong w-full max-w-md rounded-3xl p-8"
      >
        <div className="mb-8 text-center">
          <motion.div
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 12, delay: 0.2 }}
            className="text-6xl"
          >
            🦁
          </motion.div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">FocusLion</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            The student productivity app that guards your time.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
          )}
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password (min 6 characters)" value={password} minLength={6} onChange={(e) => setPassword(e.target.value)} required />

          {msg && (
            <p className={msg.kind === 'err' ? 'text-sm text-rose-500' : 'text-sm text-emerald-500'}>
              {msg.text}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            className="font-bold text-brand-500 hover:underline"
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg(null) }}
          >
            {mode === 'login' ? 'Sign up free' : 'Log in'}
          </button>
        </p>
      </motion.div>
    </div>
  )
}
