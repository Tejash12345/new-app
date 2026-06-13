import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Live map of user id → current avatar_url, for surfaces that show other
 * users' content (feed, community chat). Reads the public_profiles view so
 * avatars are always current and cover existing content — unlike the
 * denormalised author_avatar_url that was captured at write time.
 *
 * Returns a lookup function; missing/empty entries return undefined so the
 * caller can fall back to a denormalised url or initials.
 */
export function useAvatars() {
  const { data } = useQuery<Record<string, string>>({
    queryKey: ['public-avatars'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('public_profiles').select('id, avatar_url').limit(2000)
      if (error) return {} // view not created yet → fall back to denormalised
      const map: Record<string, string> = {}
      for (const r of (data ?? []) as { id: string; avatar_url: string }[]) {
        if (r.avatar_url) map[r.id] = r.avatar_url
      }
      return map
    },
    staleTime: 60_000,
  })
  return (id: string): string | undefined => data?.[id]
}
