import { cookies } from "next/headers"

import { SESSION_COOKIE } from "./protocol"

export { SESSION_COOKIE }

const SESSION_MAX_AGE = 60 * 60 * 24 * 365

function cookieIsSecure(): boolean {
  return (process.env.APP_URL ?? "").startsWith("https://")
}

/** id игрока из cookie, если он есть. */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

/** Запоминает игрока в браузере (вызывать только из Route Handler). */
export async function rememberSession(userId: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieIsSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
}