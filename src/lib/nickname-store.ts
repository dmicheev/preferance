// Запомненное имя игрока: печенье — основное хранилище, localStorage —
// страховка: имя, сохранённое до введения печенья, тоже подставим.

const COOKIE_NAME = "pf_nickname"
const STORAGE_KEY = "pf:nickname"
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/** Прочитать запомненное имя: сначала печенье, потом localStorage. */
export function readNickname(): string {
  const fromCookie = readCookie(COOKIE_NAME)
  if (fromCookie) return fromCookie
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

/** Запомнить имя после успешного входа: печенье на год плюс localStorage. */
export function rememberNickname(nickname: string): void {
  try {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(nickname)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
  } catch {
    // печенье не записалось — останется localStorage
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, nickname)
  } catch {
    // приватный режим — не страшно
  }
}

function readCookie(name: string): string | null {
  try {
    for (const entry of document.cookie.split(";")) {
      const separator = entry.indexOf("=")
      if (separator === -1) continue
      if (entry.slice(0, separator).trim() !== name) continue
      const raw = entry.slice(separator + 1).trim()
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  } catch {
    return null
  }
  return null
}
