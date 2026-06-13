export interface LeaderboardEntry {
  player_name: string
  return_rate: number
  final: number
  stock_name: string
  stock_code: string
  rank: number
  created_at?: string
  is_current_player?: boolean
}

export interface LeaderboardSubmitRequest {
  stock_code: string
  stock_name: string
  player_name: string
  player_id: string
  initial: number
  final: number
  return_rate: number
  progress: number
}

export interface LeaderboardSubmitResponse {
  rank: number
  total_players: number
  percentile: number
  is_personal_best: boolean
  personal_best: { return_rate: number; rank: number } | null
  top3: LeaderboardEntry[]
}

export interface LeaderboardQueryResponse {
  stock_code: string | null
  stock_name: string | null
  total_players: number
  entries: LeaderboardEntry[]
}

const PLAYER_ID_KEY = 'leek-knight-player-id'

export function getPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(PLAYER_ID_KEY, id)
  }
  return id
}

export async function submitScore(request: LeaderboardSubmitRequest): Promise<LeaderboardSubmitResponse> {
  const response = await fetch('/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Network error' }))
    throw new Error(error.error ?? `HTTP ${response.status}`)
  }

  return response.json()
}

export async function fetchLeaderboard(
  stock?: string,
  limit = 10,
  playerId?: string,
): Promise<LeaderboardQueryResponse> {
  const params = new URLSearchParams()
  if (stock) params.set('stock', stock)
  if (playerId) params.set('player_id', playerId)
  params.set('limit', String(limit))

  const response = await fetch(`/api/leaderboard?${params}`)
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    throw new Error(error.error ?? `HTTP ${response.status}`)
  }

  return response.json()
}
