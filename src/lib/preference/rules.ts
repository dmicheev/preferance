// Пресет очков Ленинградки. Все цифры — здесь, и они же настраиваются
// при создании стола: что выбрал хозяин, то и лежит в Game.rules.

import { GAME_LEVELS, MAX_LEVEL } from "./constants"
import type { Trump } from "./cards"

export type GameLevel = 6 | 7 | 8 | 9 | 10

export type Ruleset = {
  /** Стоимость игры в пулю по числу взяток. */
  gameValues: Record<number, number>
  /** Мизер без взяток. */
  misereValue: number
  /** Висты за взятку на шестерной игре. */
  whistRateSix: number
  /** Висты за взятку на 7–10. */
  whistRateHigh: number
  /** Висты за взятку, когда вистует один. */
  singleWhistRate: number
  /** Множитель штрафа за каждую недобранную взятку. */
  shortfallFactor: number
  /** Цена первого распаса за взятку. */
  raspasBase: number
  /** Насколько распасы дорожают от раза к разу. */
  raspasGrowth: number
}

export const DEFAULT_RULESET: Ruleset = {
  gameValues: { 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 },
  misereValue: 10,
  whistRateSix: 2,
  whistRateHigh: 1,
  singleWhistRate: 1,
  shortfallFactor: 2,
  raspasBase: 1,
  raspasGrowth: 1,
}

/** Границы для полей правил: защита от «1000000 в пулю». */
export const RULESET_LIMITS = {
  minValue: 1,
  maxValue: 100,
  maxShortfallFactor: 10,
  maxRaspasGrowth: 10,
} as const

export function gameValue(level: number, rules: Ruleset): number {
  const value = rules.gameValues[level]
  if (value === undefined) throw new Error(`Нет стоимости для ${level} взяток`)
  return value
}

/**
 * Расчётный уровень игры: без козыря считается на порядок старше и стоит
 * как игра уровнем выше — 6БК как семёрная, 7БК как восьмерная…
 * 10БК остаётся десятой, старше в Ленинградке нет.
 */
export function valueLevel(level: number, trump: Trump): number {
  return trump === "NT" ? Math.min(level + 1, MAX_LEVEL) : level
}

/**
 * Висты за взятку: на шестерной — своя цена, на 7–10 — своя.
 * Один вистующий пишет по отдельной ставке («джентльменский вист»).
 */
export function whistRate(
  level: number,
  whisters: number,
  rules: Ruleset,
): number {
  if (whisters <= 1) return rules.singleWhistRate
  return level === 6 ? rules.whistRateSix : rules.whistRateHigh
}

/** Норма одиночного вистующего: шестёрная — 4, семёрная и восьмёрная — 2, девятная — 1. */
const WHIST_QUOTA_SOLO: Record<number, number> = { 6: 4, 7: 2, 8: 2, 9: 1 }
/** Норма «на двоих»: семёрная и восьмёрная — 2, девятная — 1. */
const WHIST_QUOTA_PAIRED: Record<number, number> = { 7: 2, 8: 2, 9: 1 }

/**
 * Сколько взяток не добрал каждый вистующий — за каждую в гору по цене игры.
 * На шестёрной норма персональная: по 2 взятки с каждого. Один вистующий
 * отвечает за всю норму: 4 на шестёрной, 2 на семёрной и восьмёрной,
 * 1 на девятной. На семёрной, восьмёрной и девятной норма «на двоих»:
 * важен суммарный набор, а недобор пишется каждому вистующему полностью.
 * Десятая игра требования не имеет; бескозырка — по своему порядку
 * (6БК — как шестёрная), платится по цене бескозырки.
 */
export function whistShortfall(level: number, taken: number[]): number[] {
  if (taken.length === 0) return []
  if (taken.length === 1) {
    const quota = WHIST_QUOTA_SOLO[level] ?? 0
    return [Math.max(0, quota - taken[0])]
  }
  if (level === 6) {
    return taken.map((tricks) => Math.max(0, 2 - tricks))
  }
  const quota = WHIST_QUOTA_PAIRED[level] ?? 0
  const total = taken.reduce((sum, tricks) => sum + tricks, 0)
  const deficit = Math.max(0, quota - total)
  return taken.map(() => deficit)
}

/**
 * Приводит что угодно (JSON из БД, тело запроса) к полному набору правил:
 * неизвестное заменяется пресетом, числа зажимаются в границы.
 */
export function normalizeRuleset(input: unknown): Ruleset {
  const source = isRecord(input) ? input : {}

  const gameValues: Record<number, number> = {}
  const rawValues = isRecord(source.gameValues) ? source.gameValues : {}
  for (const level of GAME_LEVELS) {
    gameValues[level] = clampNumber(
      rawValues[level] ?? rawValues[String(level)],
      DEFAULT_RULESET.gameValues[level],
      RULESET_LIMITS.maxValue,
    )
  }

  return {
    gameValues,
    misereValue: clampNumber(
      source.misereValue,
      DEFAULT_RULESET.misereValue,
      RULESET_LIMITS.maxValue,
    ),
    whistRateSix: clampNumber(
      source.whistRateSix,
      DEFAULT_RULESET.whistRateSix,
      RULESET_LIMITS.maxValue,
    ),
    whistRateHigh: clampNumber(
      source.whistRateHigh,
      DEFAULT_RULESET.whistRateHigh,
      RULESET_LIMITS.maxValue,
    ),
    singleWhistRate: clampNumber(
      source.singleWhistRate,
      DEFAULT_RULESET.singleWhistRate,
      RULESET_LIMITS.maxValue,
    ),
    shortfallFactor: clampNumber(
      source.shortfallFactor,
      DEFAULT_RULESET.shortfallFactor,
      RULESET_LIMITS.maxShortfallFactor,
    ),
    raspasBase: clampNumber(
      source.raspasBase,
      DEFAULT_RULESET.raspasBase,
      RULESET_LIMITS.maxValue,
    ),
    raspasGrowth: clampNumber(
      source.raspasGrowth,
      DEFAULT_RULESET.raspasGrowth,
      RULESET_LIMITS.maxRaspasGrowth,
    ),
  }
}

/** Правила отличаются от пресета — тогда в интерфейсе стоит пометка. */
export function isCustomRuleset(rules: Ruleset): boolean {
  return (
    JSON.stringify(normalizeRuleset(rules)) !==
    JSON.stringify(normalizeRuleset(DEFAULT_RULESET))
  )
}

function clampNumber(value: unknown, fallback: number, max: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(parsed)) return fallback
  const rounded = Math.round(parsed)
  return Math.min(max, Math.max(RULESET_LIMITS.minValue, rounded))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}