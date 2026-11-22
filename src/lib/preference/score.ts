// Подсчёт очков Ленинградки: пуля, гора, висты.
// Сами цифры живут в Ruleset (rules.ts): пресет по умолчанию или выбор хозяина стола.

import { GAME_LEVELS, PLAYER_COUNT } from "./constants"
import type { RoundOutcome, Seat } from "./round"
import {
  DEFAULT_RULESET,
  gameValue,
  whistRate,
  type Ruleset,
} from "./rules"

export { DEFAULT_RULESET, gameValue, whistRate, type Ruleset }

export type ScoreEntry = {
  /** Очки в пуле: закрытая пуля = победа. */
  pool: number
  /** Гора: штрафные очки. */
  mountain: number
  /** Висты, записанные игроку в плюс. */
  whists: number
}

export type ScoreTable = {
  /** До скольких очков закрывается пуля. */
  bullet: number
  entries: ScoreEntry[]
  /** Текущая цена распасов: 1, 2, 3… */
  raspasStep: number
  rules: Ruleset
}

export type RoundScore = {
  table: ScoreTable
  /** Что именно изменилось именно в этой раздаче. */
  deltas: ScoreEntry[]
}

export function createScoreTable(
  bullet: number,
  rules: Ruleset = DEFAULT_RULESET,
): ScoreTable {
  return {
    bullet,
    entries: Array.from({ length: PLAYER_COUNT }, () => ({
      pool: 0,
      mountain: 0,
      whists: 0,
    })),
    raspasStep: rules.raspasBase,
    rules,
  }
}

export function applyRoundScore(
  table: ScoreTable,
  outcome: RoundOutcome,
): RoundScore {
  const { rules } = table
  const entries = table.entries.map((entry) => ({ ...entry }))
  const deltas: ScoreEntry[] = entries.map(() => ({
    pool: 0,
    mountain: 0,
    whists: 0,
  }))

  // Перебор пули не пишется: играем ровно до bullet.
  const addPool = (seat: Seat, value: number) => {
    const room = Math.max(0, table.bullet - entries[seat].pool)
    const gain = Math.min(value, room)
    entries[seat].pool += gain
    deltas[seat].pool += gain
  }

  const addMountain = (seat: Seat, value: number) => {
    entries[seat].mountain += value
    deltas[seat].mountain += value
  }

  const addWhists = (seat: Seat, value: number) => {
    entries[seat].whists += value
    deltas[seat].whists += value
  }

  let raspasStep = table.raspasStep

  switch (outcome.contract.kind) {
    case "game": {
      const declarer = outcome.declarer
      if (declarer === null) break
      const { level } = outcome.contract
      const taken = outcome.tricks[declarer]
      const need = level

      if (taken >= need) {
        addPool(declarer, gameValue(level, rules))
      } else {
        addMountain(
          declarer,
          (need - taken) * rules.shortfallFactor * gameValue(level, rules),
        )
      }

      const rate = whistRate(level, outcome.whisters.length, rules)
      for (const seat of outcome.whisters) {
        addWhists(seat, outcome.tricks[seat] * rate)
      }
      raspasStep = rules.raspasBase
      break
    }

    case "misere": {
      const declarer = outcome.declarer
      if (declarer === null) break
      const taken = outcome.tricks[declarer]

      if (taken === 0) {
        addPool(declarer, rules.misereValue)
      } else {
        addMountain(
          declarer,
          taken * rules.shortfallFactor * rules.misereValue,
        )
      }
      raspasStep = rules.raspasBase
      break
    }

    case "raspas": {
      for (let seat = 0; seat < PLAYER_COUNT; seat += 1) {
        addMountain(seat as Seat, outcome.tricks[seat] * raspasStep)
      }
      raspasStep += rules.raspasGrowth
      break
    }
  }

  return {
    table: {
      bullet: table.bullet,
      entries,
      raspasStep,
      rules,
    },
    deltas,
  }
}

/** Пуля закрыта у всех? Тогда пора считать итог партии. */
export function isBulletClosed(table: ScoreTable): boolean {
  return table.entries.every((entry) => entry.pool >= table.bullet)
}

export type Standing = {
  seat: Seat
  place: number
  /** Итог: пуля минус гора плюс висты. */
  score: number
}

/** Итог партии: места по «пуля − гора + висты». Ничья — меньше гора, затем место. */
export function finalStandings(table: ScoreTable): Standing[] {
  const scored = table.entries
    .map((entry, seat) => ({
      seat: seat as Seat,
      score: entry.pool - entry.mountain + entry.whists,
      mountain: entry.mountain,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.mountain - right.mountain ||
        left.seat - right.seat,
    )

  return scored.map((entry, index) => ({
    seat: entry.seat,
    place: index + 1,
    score: entry.score,
  }))
}

/** Короткая строка правил для интерфейса: «2/4/6/8/10 · мизер 10 · висты 2/1». */
export function rulesetSummary(rules: Ruleset): string {
  const values = GAME_LEVELS.map((level) => rules.gameValues[level] ?? "—").join("/")
  return `игры ${values} · мизер ${rules.misereValue} · висты ${rules.whistRateSix}/${rules.whistRateHigh}`
}