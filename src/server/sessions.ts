// Стор игровых сеансов: один сервер — одна правда о партиях.
// Сеансы живут в памяти: перезапуск сервера сбрасывает партии (стол собирается заново).

import { randomInt } from "node:crypto"

import {
  createSession,
  type SessionPlayer,
  type SessionState,
} from "./session-core"

const sessions = new Map<string, SessionState>()

export function getSession(key: string): SessionState | null {
  return sessions.get(key) ?? null
}

export function saveSession(session: SessionState): void {
  sessions.set(session.key, session)
}

export function dropSession(key: string): void {
  sessions.delete(key)
}

/** Существующий сеанс не трогаем: память важнее БД. */
export function ensureSession(params: {
  key: string
  gameId: string
  bullet: number
  roundsLimit: number | null
  rules: unknown
  players: SessionPlayer[]
}): SessionState {
  const existing = sessions.get(params.key)
  if (existing) return existing

  const fresh = createSession(params)
  sessions.set(params.key, fresh)
  return fresh
}

/** Зерно раздачи: настоящий случай, детерминизм нужен только тестам движка. */
export function nextSeed(): number {
  return randomInt(1, 2 ** 31)
}
