import { cookies } from "next/headers"

import { SESSION_COOKIE } from "./protocol"
import { signSessionToken, verifySessionToken } from "./session-token"

export { SESSION_COOKIE }

/** Печенье с запомненным именем игрока (пишет клиент, см. lib/nickname-store). */
const NICKNAME_COOKIE = "pf_nickname"

const SESSION_MAX_AGE = 60 * 60 * 24 * 365

function cookieIsSecure(): boolean {
  return (process.env.APP_URL ?? "").startsWith("https://")
}

/** id игрока из cookie, если подпись сошлась. */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies()
  return verifySessionToken(store.get(SESSION_COOKIE)?.value)
}

/** Запомненное имя из печенья — для подстановки в формы входа на сервере. */
export async function readNicknameCookie(): Promise<string> {
  const raw = (await cookies()).get(NICKNAME_COOKIE)?.value ?? ""
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Запоминает игрока в браузере (вызывать только из Route Handler). */
export async function rememberSession(userId: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, signSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieIsSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
}