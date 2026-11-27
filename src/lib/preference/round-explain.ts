// Человеческое объяснение расчёта раздачи: почему у кого сколько записалось.
// Чистые функции без React — годится и для серверных страниц истории,
// и для клиентских панелей стола. Цифры повторяют applyRoundScore из score.ts.

import type { RoundResultView } from "../protocol"
import { otherSeats, type Seat } from "./round"
import { gameValue, valueLevel, whistRate, whistShortfall } from "./score"

/** «1 взятка / 2 взятки / 5 взяток» — по правилам русского множественного. */
export function tricksLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} взятка`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} взятки`
  }
  return `${count} взяток`
}

/** «1 вист / 2 виста / 5 вистов». */
export function whistsLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} вист`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} виста`
  }
  return `${count} вистов`
}

/** Итоговая формула игрока: «пуля 20 − гора 14 + висты 22 = 28». */
export function scoreFormula(entry: {
  pool: number
  mountain: number
  whists: number
}): string {
  return `пуля ${entry.pool} − гора ${entry.mountain} + висты ${entry.whists}`
}

const seatName = (seat: Seat) => `место ${seat + 1}`

/**
 * Строки расчёта раздачи: как получились записи в таблицу.
 * nameOf — как назвать игрока по месту (в интерфейсе это ник).
 */
export function roundCalculation(
  result: RoundResultView,
  nameOf: (seat: Seat) => string = seatName,
): string[] {
  const rules = result.table.rules
  const { contract, declarer, tricks, whisters } = result.outcome
  const lines: string[] = []

  switch (contract.kind) {
    case "game": {
      if (declarer === null) break
      const cost = valueLevel(contract.level, contract.trump)
      const price = gameValue(cost, rules)
      const taken = tricks[declarer]
      const need = contract.level

      if (taken >= need) {
        const written = result.deltas[declarer]?.pool ?? price
        lines.push(
          written < price
            ? `${nameOf(declarer)} сыграл: взял ${taken} из ${need} — ${price} в пулю, но пуля уже почти закрыта: записано ${written}`
            : `${nameOf(declarer)} сыграл: взял ${taken} из ${need} — ${price} в пулю`,
        )
      } else {
        const missing = need - taken
        const fine = missing * rules.shortfallFactor * price
        lines.push(
          `${nameOf(declarer)} подсел: взял ${taken} из ${need} — ${missing} × ${rules.shortfallFactor} × ${price} = ${fine} на гору`,
        )
      }

      if (whisters.length > 0) {
        const rate = whistRate(cost, whisters.length, rules)
        const solo = whisters.length === 1
        const wonBy = whisters.map((seat) => {
          let won = tricks[seat]
          if (solo) {
            // Одиночный вист: вистующий играл за себя и за пасующего.
            const passer = otherSeats(declarer).find((item) => item !== seat)
            if (passer !== undefined) won += tricks[passer]
          }
          return won
        })

        whisters.forEach((seat, index) => {
          const won = wonBy[index]
          const written = result.deltas[seat]?.whists ?? won * rate
          if (solo) {
            lines.push(
              `${nameOf(seat)} вистовал один и играл за двоих: ${tricksLabel(won)} × ${rate} = ${whistsLabel(written)}`,
            )
          } else {
            lines.push(
              `${nameOf(seat)}: ${tricksLabel(won)} × ${rate} = ${whistsLabel(written)}`,
            )
          }
        })

        // Недобор до нормы виста — на гору по цене игры.
        const shortfall = whistShortfall(contract.level, wonBy)
        const deficit = Math.max(...shortfall, 0)
        if (deficit > 0) {
          const quota = wonBy.reduce((sum, value) => sum + value, 0) + deficit
          const guilty = whisters.filter((_, index) => shortfall[index] > 0)
          lines.push(
            `норма виста — ${tricksLabel(quota)}, не добрано ${deficit}: ${deficit} × ${price} = ${deficit * price} на гору (${guilty.map(nameOf).join(" и ")})`,
          )
        }
      } else {
        lines.push("вистовать никто не стал — вистов в записи нет")
      }
      break
    }

    case "misere": {
      if (declarer === null) break
      const taken = tricks[declarer]
      if (taken === 0) {
        lines.push(
          `${nameOf(declarer)} сыграл мизер — ни одной взятки, ${rules.misereValue} в пулю`,
        )
      } else {
        const fine = taken * rules.shortfallFactor * rules.misereValue
        lines.push(
          `мизер сорван: ${tricksLabel(taken)} — ${taken} × ${rules.shortfallFactor} × ${rules.misereValue} = ${fine} на гору`,
        )
      }
      break
    }

    case "raspas": {
      // applyRoundScore пишет по цене на момент раздачи, потом дорожает:
      // в итоговой таблице шаг уже подрос — откатываем на один прирост.
      const step = Math.max(
        1,
        result.table.raspasStep - rules.raspasGrowth,
      )
      ;([0, 1, 2] as Seat[]).forEach((seat) => {
        const taken = tricks[seat]
        if (taken === 0) {
          lines.push(`${nameOf(seat)}: без взяток — чисто`)
        } else {
          lines.push(
            `${nameOf(seat)}: ${tricksLabel(taken)} × ${step} = ${taken * step} на гору`,
          )
        }
      })
      lines.push(`цена следующего распаса — ${result.table.raspasStep} за взятку`)
      break
    }
  }

  return lines
}
