/**
 * Lightweight, dependency-free string-similarity scoring for "did you mean…"
 * suggestions (product/supplier name matching). Pure client-side, no AI call:
 * fast, free, private, and good enough for spelling variants, word-order
 * differences, and partial-name matches — the bulk of real iiko naming noise.
 *
 * It will NOT bridge a fully generic label ("Ягода в ассортименте") to a
 * specific item ("Малина") — there is no textual signal to find there. That
 * case genuinely needs a human pick (or a supplier-aware/AI hint later).
 */

const STOP = new Set(['с', 'м', 'кг', 'в', 'и', 'на', 'для', 'из', 'по'])

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/["'«»()]/g, ' ')
    .split(/[^a-zа-яё0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP.has(t))
}

/** Classic edit distance, used only on short strings so O(n*m) is fine. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

function charSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

/** Score in [0,1]: higher = more likely the same real-world item. */
export function similarity(query: string, candidate: string): number {
  const q = query.toLowerCase().trim()
  const c = candidate.toLowerCase().trim()
  if (!q || !c) return 0
  if (q === c) return 1

  let score = 0
  if (c.includes(q) || q.includes(c)) score = Math.max(score, 0.75)

  const qt = new Set(tokens(q))
  const ct = new Set(tokens(c))
  if (qt.size && ct.size) {
    let shared = 0
    for (const t of qt) if (ct.has(t)) shared++
    const jaccard = shared / (qt.size + ct.size - shared)
    score = Math.max(score, jaccard * 0.9)
  }

  // Character-level similarity catches typos/spelling variants on short names.
  if (q.length <= 40 && c.length <= 40) {
    score = Math.max(score, charSimilarity(q, c) * 0.6)
  }

  return score
}

export interface Scored<T> { item: T; score: number }

/** Ranks candidates by similarity to `query`, keeping only plausible matches. */
export function rankSimilar<T>(query: string, candidates: T[], name: (t: T) => string, min = 0.28): Scored<T>[] {
  return candidates
    .map((item) => ({ item, score: similarity(query, name(item)) }))
    .filter((s) => s.score >= min)
    .sort((a, b) => b.score - a.score)
}
