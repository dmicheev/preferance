/**
 * Простой ограничитель частоты в памяти процесса: окна фиксированной длины,
 * корзина на клиента. Для клубной игры этого достаточно — цель не отбить
 * распределённую DDoS-атаку, а не дать заспамить базу столами и регистрациями.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
let lastSweepAt = Date.now()

/** Раз в минуту выбрасываем протухшие корзины, чтобы Map не рос бесконечно. */
function sweepExpired(now: number) {
  if (now - lastSweepAt < 60_000) return
  lastSweepAt = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/** true — лимит исчерпан, запрос надо отклонить (HTTP 429 / ошибка сокету). */
export function isRateLimited(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now()
  sweepExpired(now)

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }

  bucket.count += 1
  return bucket.count > limit
}

/**
 * Ключ по клиенту. За честным прокси (x-forwarded-for) IP ставит сам прокси,
 * при прямом подключении заголовка нет и все запросы попадут в одну корзину —
 * это осознанный компромисс: для открытого порта глобальный лимит даже надёжнее.
 */
export function clientRateKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const ip = forwarded?.split(",")[0]?.trim() || "unknown"
  return `${scope}:${ip}`
}
