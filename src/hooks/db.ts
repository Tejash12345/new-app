import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

let channelSeq = 0

/** Generic CRUD + realtime hooks for user-owned tables. */
export function useTable<T extends { id: string }>(
  table: string,
  opts?: { orderBy?: string; ascending?: boolean },
) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const key = [table, user?.id]

  const query = useQuery<T[]>({
    queryKey: key,
    enabled: !!user,
    queryFn: async () => {
      let q = supabase.from(table).select('*').eq('user_id', user!.id)
      if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending ?? false })
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as T[]
    },
  })

  // realtime sync — channel topic must be unique per hook instance, otherwise
  // two components watching the same table collide ("cannot add callbacks after subscribe")
  const instanceId = useRef(++channelSeq)
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`rt-${table}-${user.id}-${instanceId.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: key }),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, user?.id])

  const insert = useMutation({
    mutationFn: async (row: Partial<T>) => {
      const { error } = await supabase.from(table).insert({ ...row, user_id: user!.id })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<T> & { id: string }) => {
      const { error } = await supabase.from(table).update(patch as Record<string, unknown>).eq('id', id)
      if (error) throw error
    },
    // optimistic: apply the change to the cache instantly so sliders/toggles
    // don't snap back while the network round-trip completes
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<T[]>(key)
      qc.setQueryData<T[]>(key, (old) =>
        old?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? [])
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    insert: insert.mutateAsync,
    update: update.mutateAsync,
    remove: remove.mutateAsync,
  }
}
