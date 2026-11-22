import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Cookie сессии никогда не покидает сервер «сырым» userId: наружу уходит
 * id + HMAC-подпись секретом. Иначе любой, кто узнает чужой id,
 * подставил бы cookie и играл от чужого имени.
 */

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET не задан или короче 32 символов — сгенерируй `openssl rand -hex 32` и добавь в .env",
    )
  }
  return secret
}

/** «<userId>.<hex-подпись>» — значение, которое кладётся в cookie. */
export function signSessionToken(userId: string): string {
  const signature = createHmac("sha256", sessionSecret())
    .update(userId)
    .digest("hex")
  return `${userId}.${signature}`
}

/** Проверяет подпись и возвращает userId или null (подделка, мусор, пусто). */
export function verifySessionToken(
  token: string | null | undefined,
): string | null {
  if (!token) return null
  const separator = token.lastIndexOf(".")
  if (separator <= 0) return null

  const userId = token.slice(0, separator)
  const given = Buffer.from(token.slice(separator + 1), "hex")
  const expected = Buffer.from(
    createHmac("sha256", sessionSecret()).update(userId).digest("hex"),
    "hex",
  )

  if (given.length !== expected.length) return null
  if (!timingSafeEqual(given, expected)) return null
  return userId
}
