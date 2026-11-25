// Тесты солвера: очковая оценка, точная докрутка концевика, листовая эвристика.
import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_RULESET, type Ruleset } from "./rules"
import {
  searchSim,
  seatPotential,
  simAfterMove,
  utilityOfTricks,
  type ContractCtx,
  type SimState,
  type SolveCtx,
} from "./solver"
import type { Seat } from "./round"

const rules: Ruleset = DEFAULT_RULESET

function solveCtx(perspective: Seat, contract: ContractCtx): SolveCtx {
  return { contract, rules, raspasStep: 1, perspective, mode: "points" }
}

test("utilityOfTricks: своя шестёрная без двух против двух вистующих", () => {
  // Играющий взял 6, защитники по 2: пуля +2 у нас, по 4 виста у них.
  const ctx = solveCtx(0, {
    kind: "game",
    level: 6,
    trump: "S",
    declarer: 0,
    whisters: [1, 2],
  })
  const ev = utilityOfTricks([6, 2, 2], ctx)
  // мы: +2, соперники: +4 и +4 → 2 − 4 = −2
  assert.equal(ev, -2)
})

test("utilityOfTricks: посадившийся играющий платит в гору", () => {
  const ctx = solveCtx(0, {
    kind: "game",
    level: 6,
    trump: "S",
    declarer: 0,
    whisters: [1, 2],
  })
  // 4 взятки: недобор 2 × 2 × 2 = 8 в гору; вистующие вместе 6 — норма
  // пары закрыта, но свои 6 вистов (3 × 2) у каждого: −8 − 6.
  const ev = utilityOfTricks([4, 3, 3], ctx)
  assert.equal(ev, -8 - 6)
})

test("utilityOfTricks: мизер без взяток против пойманного", () => {
  const ctx = solveCtx(0, {
    kind: "misere",
    level: 0,
    trump: "NT",
    declarer: 0,
    whisters: [],
  })
  const clean = utilityOfTricks([0, 5, 5], ctx)
  assert.equal(clean, 10)
  const caught = utilityOfTricks([2, 4, 4], ctx)
  // 2 взятки × 2 × 10 = 40 в гору.
  assert.equal(caught, -40)
})

test("searchSim: концевик доигрывается точно и находит единственный выигрыш", () => {
  // Последняя взятка: наш туз против двух карт — ход наш.
  const state: SimState = {
    hands: [
      ["SA"],
      ["S7"],
      ["HK"],
    ],
    trick: [],
    turn: 0,
    trump: "NT",
    tricks: [0, 0, 0],
    tricksLeft: 1,
  }
  const ctx = solveCtx(0, {
    kind: "raspas",
    level: 0,
    trump: "NT",
    declarer: null,
    whisters: [],
  })
  // Распас по 1 за взятку: мы берём тузом → 1 в гору, соперники по 0.
  const ev = searchSim(state, ctx, new Set([0]), 3, { nodes: 0, deadline: Date.now() + 1000 })
  // мы: −1, соперники: 0 и 0 → −1 − 0 = −1
  assert.equal(ev, -1)
})

test("searchSim: мизер — уклонение от взятки находится поиском", () => {
  // Мизер играющего 0: он под ходом короля в масть, есть отдача семёркой.
  const state: SimState = {
    hands: [
      ["HK", "H7"],
      ["HA", "D7"],
      ["HQ", "D8"],
    ],
    trick: [],
    turn: 0,
    trump: "NT",
    tricks: [0, 0, 0],
    tricksLeft: 2,
  }
  const ctx = solveCtx(0, {
    kind: "misere",
    level: 0,
    trump: "NT",
    declarer: 0,
    whisters: [],
  })
  // Ход королём ловится тузом; семёрка проходит — поиск обязан выбрать семёрку
  // и оценить результат лучше, чем ход королём.
  const deadline = Date.now() + 2000
  const ev = searchSim(state, ctx, new Set([0]), 3, { nodes: 0, deadline })
  assert.equal(ev, 10, "чистый мизер должен оцениваться в +10 относительно соперников")
})

test("searchSim: состояние восстанавливается после поиска (регрессия отката взятки)", () => {
  const state: SimState = {
    hands: [
      ["SA", "SK", "HA", "HK", "DA"],
      ["S7", "S8", "H7", "H8", "D7"],
      ["SQ", "SJ", "HQ", "HJ", "D8"],
    ],
    trick: [],
    turn: 0,
    trump: "S",
    tricks: [0, 0, 0],
    tricksLeft: 5,
  }
  const snapshot = JSON.stringify(state)
  const ctx = solveCtx(0, {
    kind: "game",
    level: 6,
    trump: "S",
    declarer: 0,
    whisters: [1, 2],
  })
  searchSim(state, ctx, new Set([0]), 3, { nodes: 0, deadline: Date.now() + 5000 })
  assert.equal(JSON.stringify(state), snapshot, "мутации поиска не должны переживать возврат")
})

test("simAfterMove: взятка распасов собирается тремя картами игроков", () => {
  const state: SimState = {
    hands: [
      ["SA", "CA"],
      ["H7", "C7"],
      ["HQ", "C8"],
    ],
    trick: [{ seat: 0, card: "HA", fromPrikup: true }],
    turn: 1,
    trump: "NT",
    tricks: [0, 0, 0],
    tricksLeft: 2,
    kittyLead: "S7",
  }
  let next = simAfterMove(state, 1, "H7")
  assert.equal(next.trick.length, 2, "заход прикупа ждёт карты игроков")
  next = simAfterMove(next, 2, "HQ")
  next = simAfterMove(next, 0, "SA")

  // HA прикупа старше всех, но взятку берёт HQ у места 2; вторая взятка
  // сразу заходит второй картой прикупа.
  assert.deepEqual(next.tricks, [0, 0, 1])
  assert.deepEqual(next.trick, [{ seat: 2, card: "S7", fromPrikup: true }])
  assert.equal(next.turn, 2)
  assert.equal(next.kittyLead, null)
  assert.equal(next.tricksLeft, 1)
})

test("seatPotential: старшие карты без прикрытия считаются мастерами", () => {
  const state: SimState = {
    hands: [
      ["SA", "SK", "HA"],
      ["SQ", "SJ", "HQ"],
      ["S10", "S9", "HJ"],
    ],
    trick: [],
    turn: 0,
    trump: "S",
    tricks: [0, 0, 0],
    tricksLeft: 3,
  }
  // Пики: туз и король старше внешних (2 мастера); черва могут затромпить —
  // туз идёт с коэффициентом 0.4.
  const potential = seatPotential(state, 0)
  assert.ok(potential >= 2 && potential < 3, `потенциал должен быть ≈ 2.4, получен ${potential}`)
})
