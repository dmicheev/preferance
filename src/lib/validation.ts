import { z } from "zod"

import { RULESET_LIMITS } from "./preference/rules"
import {
  CHAT_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
} from "./protocol"

const valueSchema = z.coerce
  .number()
  .int()
  .min(RULESET_LIMITS.minValue)
  .max(RULESET_LIMITS.maxValue)

export const BULLET_OPTIONS = [10, 20, 30, 50] as const
export const ROUNDS_OPTIONS = [10, 20, 30, null] as const
export const GAME_KEY_LENGTH = 6

const NICKNAME_ALLOWED = /[\p{L}\p{N} _'-]/u

/** Убирает лишние пробелы и символы, которые не должны попадать в ник. */
export function normalizeNickname(raw: string): string {
  const cleaned = Array.from(raw)
    .filter((char) => NICKNAME_ALLOWED.test(char))
    .join("")
    .replace(/\s+/g, " ")
    .trimStart()

  return cleaned.slice(0, NICKNAME_MAX_LENGTH)
}

/** Ключ стола: только заглавные буквы и цифры, без похожих символов. */
export function normalizeGameKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, GAME_KEY_LENGTH)
}

export const nicknameSchema = z
  .string()
  .transform(normalizeNickname)
  .refine(
    (value) =>
      value.length >= NICKNAME_MIN_LENGTH && value.length <= NICKNAME_MAX_LENGTH,
    { message: `Ник — от ${NICKNAME_MIN_LENGTH} до ${NICKNAME_MAX_LENGTH} символов` },
  )

export const gameKeySchema = z.string().transform(normalizeGameKey).refine(
  (value) => value.length === GAME_KEY_LENGTH,
  { message: "Ключ стола — 6 символов" },
)

export const chatTextSchema = z
  .string()
  .trim()
  .min(1, { message: "Пустое сообщение" })
  .max(CHAT_MAX_LENGTH, { message: `Не длиннее ${CHAT_MAX_LENGTH} символов` })

export const rulesetSchema = z.object({
  gameValues: z
    .object({
      6: valueSchema,
      7: valueSchema,
      8: valueSchema,
      9: valueSchema,
      10: valueSchema,
    })
    .partial()
    .optional(),
  misereValue: valueSchema.optional(),
  whistRateSix: valueSchema.optional(),
  whistRateHigh: valueSchema.optional(),
  singleWhistRate: valueSchema.optional(),
  shortfallFactor: z.coerce
    .number()
    .int()
    .min(RULESET_LIMITS.minValue)
    .max(RULESET_LIMITS.maxShortfallFactor)
    .optional(),
  raspasBase: valueSchema.optional(),
  raspasGrowth: z.coerce
    .number()
    .int()
    .min(RULESET_LIMITS.minValue)
    .max(RULESET_LIMITS.maxRaspasGrowth)
    .optional(),
})

export const createGameSchema = z.object({
  nickname: nicknameSchema,
  variant: z.enum(["LENINGRADKA", "SOCHINKA"]).default("LENINGRADKA"),
  bullet: z.coerce
    .number()
    .int()
    .refine(
      (value) => (BULLET_OPTIONS as readonly number[]).includes(value),
      { message: "Пуля: 10, 20, 30 или 50" },
    ),
  roundsLimit: z
    // Литерал null первым: иначе coerce превратит null в 0 и «без лимита» отвалится.
    .union([z.literal(null), z.coerce.number().int()])
    .refine(
      (value) => (ROUNDS_OPTIONS as readonly (number | null)[]).includes(value),
      { message: "Лимит раздач: 10, 20, 30 или без лимита" },
    ),
  allowSpectators: z.boolean().default(false),
  rules: rulesetSchema.optional(),
  title: z.string().trim().max(48).optional(),
})

export const joinGameSchema = z.object({
  nickname: nicknameSchema,
})

export type CreateGameInput = z.infer<typeof createGameSchema>
export type JoinGameInput = z.infer<typeof joinGameSchema>