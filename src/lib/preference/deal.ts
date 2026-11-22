// Раздача: детерминированное перемешивание от зерна, 10 карт каждому игроку и 2 в прикуп.

import { FULL_DECK, type Card } from "./cards"
import { PLAYER_COUNT, TRICKS_PER_ROUND } from "./constants"

export type Deal = {
  hands: Card[][]
  prikup: [Card, Card]
}

/** Быстрый PRNG (mulberry32): одинаковое зерно — одинаковая раздача. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Перемешивание Фишера—Йетса, без мутаций входа. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[swapWith]
    result[swapWith] = current
  }
  return result
}

export function dealCards(seed: number): Deal {
  const deck = shuffle(FULL_DECK, mulberry32(seed))
  const hands: Card[][] = []
  for (let seat = 0; seat < PLAYER_COUNT; seat += 1) {
    hands.push(deck.slice(seat * TRICKS_PER_ROUND, (seat + 1) * TRICKS_PER_ROUND))
  }
  const prikup = deck.slice(PLAYER_COUNT * TRICKS_PER_ROUND)
  return { hands, prikup: [prikup[0], prikup[1]] }
}