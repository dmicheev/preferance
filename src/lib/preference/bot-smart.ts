// Умный бот: Монте-Карло по скрытым картам + альфа-бета докрутка раздачи.
// Оценка хода — ожидаемые очки (пуля/гора/висты относительно соперников),
// а не «взял взятку». Бюджет сэмплов и глубины задаётся уровнем бота;
// при исчерпании бюджета решение откатывается к легаси-эвристикам bot.ts.

import {
  SUITS,
  compareHandCards,
  suitOf,
  type Card,
  type Trump,
} from "./cards"
import { MAX_LEVEL, MIN_LEVEL, PLAYER_COUNT, TRICKS_PER_ROUND } from "./constants"
import {
  cardsToDiscard,
  chooseAction as legacyAction,
  choosePlay,
  declareRaise,
  hasCleanSuit,
  misereDiscard,
  type BotLevel,
} from "./bot"
import {
  dealGeometry,
  geometryConsistent,
  sampleDeals,
  voidSuits,
} from "./insight"
import {
  bidStrength,
  legalMoves,
  otherSeats,
  type RoundAction,
  type RoundState,
  type Seat,
} from "./round"
import type { Ruleset } from "./rules"
import {
  BudgetAbort,
  contractCtxOf,
  searchSim,
  seatPotential,
  simAfterMove,
  simFromRound,
  utilityOfTricks,
  type ContractCtx,
  type SimState,
  type SolveCtx,
} from "./solver"

const SUIT_TRUMPS: Trump[] = ["S", "C", "D", "H"]

export type SmartBudgets = {
  /** Сэмплов расклада на ход картой / вист. */
  samples: number
  /** Сэмплов на решение в торговле (там перебор контрактов). */
  samplesBid: number
  /** Глубина поиска во взятках (концевик доигрывается точно). */
  depth: number
  /** Жёсткий дедлайн на решение, мс. */
  timeMs: number
  /** Доля случайных ходов — цена слабого уровня. */
  noise: number
}

export const LEVEL_BUDGETS: Record<BotLevel, SmartBudgets> = {
  NOVICE: { samples: 12, samplesBid: 12, depth: 2, timeMs: 350, noise: 0.1 },
  PLAYER: { samples: 48, samplesBid: 40, depth: 3, timeMs: 1200, noise: 0 },
  MASTER: { samples: 120, samplesBid: 80, depth: 4, timeMs: 3000, noise: 0 },
}

export type SmartContext = {
  rules: Ruleset
  /** Текущая цена распасов за взятку. */
  raspasStep: number
  /** Переопределение бюджетов уровней — для бенчмарков и тестов. */
  budgets?: Partial<Record<BotLevel, Partial<SmartBudgets>>>
}

export function budgetsFor(level: BotLevel, ctx: SmartContext): SmartBudgets {
  return { ...LEVEL_BUDGETS[level], ...ctx.budgets?.[level] }
}

/* ---------- детерминированный генератор ---------- */

function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Пуловер с сидом из состояния: одно и то же состояние — одно и то же решение. */
function rngFor(round: RoundState, seat: Seat): () => number {
  const key = [
    round.seed,
    seat,
    round.phase,
    round.history.length,
    round.trick.length,
    round.bids
      .map((bid) =>
        bid === null
          ? "-"
          : typeof bid === "string"
            ? "п"
            : "kind" in bid
              ? "м"
              : `${bid.level}${bid.trump}`,
      )
      .join(""),
    round.whist.map((entry) => (entry === null ? "-" : entry ? "в" : "п")).join(""),
    round.discard.join(""),
    round.prikup.join(""),
  ].join("|")
  let state = fnv1a(key) || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Уступить event loop: поиск до секунд не должен замораживать сокеты. */
const yieldToLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

/* ---------- общие помощники ---------- */

function seatHands(
  seat: Seat,
  hand: Card[],
  others: [Seat, Seat],
  dealt: [Card[], Card[]],
): Card[][] {
  const hands: Card[][] = [[], [], []]
  hands[seat] = hand
  hands[others[0]] = dealt[0]
  hands[others[1]] = dealt[1]
  return hands
}

/**
 * Сговор: мы максимизируем своё; защищаясь от игры, партнёр тоже за нас.
 * В распасах и на своей игре каждый сам за себя.
 */
function maxSeatsFor(contract: ContractCtx, seat: Seat): Set<Seat> {
  const seats = new Set<Seat>([seat])
  if (contract.kind !== "raspas" && contract.declarer !== null && contract.declarer !== seat) {
    for (const other of otherSeats(contract.declarer)) {
      if (other !== seat) seats.add(other)
    }
  }
  return seats
}

function solveCtxOf(
  round: RoundState,
  seat: Seat,
  ctx: SmartContext,
  overrides: Partial<SolveCtx> = {},
): SolveCtx {
  return {
    contract: contractCtxOf(round),
    rules: ctx.rules,
    raspasStep: ctx.raspasStep,
    perspective: seat,
    mode: "points",
    ...overrides,
  }
}

function pairKey(pair: Card[]): string {
  return [...pair].sort().join("")
}

type Bucket<T> = { subject: T; sum: number; n: number }

/** Незавершённый сэмпл не учитываем вовсе: иначе сравнение ходов перекошено. */
function rollbackBuckets<T>(buckets: Bucket<T>[], snapshot: Array<{ sum: number; n: number }>): void {
  buckets.forEach((bucket, index) => {
    bucket.sum = snapshot[index].sum
    bucket.n = snapshot[index].n
  })
}

function snapshotBuckets<T>(buckets: Bucket<T>[]): Array<{ sum: number; n: number }> {
  return buckets.map((bucket) => ({ sum: bucket.sum, n: bucket.n }))
}

/** Кандидаты сноса: дешёвые пары, по одной из масти, легаси-пара. Не больше шести. */
function discardCandidates(hand: Card[], trump: Trump, keepClean: boolean): Card[][] {
  const ordered = [...hand].sort(compareHandCards)
  const cleanSuits = keepClean
    ? [...SUITS].filter((suit) => suit !== trump && hasCleanSuit(hand, suit))
    : []
  const pool = ordered.filter((card) => !cleanSuits.includes(suitOf(card)))
  const source = pool.length >= 2 ? pool : ordered

  const candidates: Card[][] = []
  const seen = new Set<string>()
  const consider = (pair: Card[]): void => {
    if (pair.length !== 2 || pair[0] === pair[1]) return
    const key = pairKey(pair)
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(pair)
  }

  const last = source[source.length - 1]
  consider([last, source[source.length - 2]])
  for (const suit of SUITS) {
    const suited = source.filter((card) => suitOf(card) === suit)
    if (suited.length === 0) continue
    consider([last, suited[suited.length - 1]])
    if (suited.length >= 2) consider([suited[suited.length - 1], suited[suited.length - 2]])
  }
  consider(cardsToDiscard(hand, trump, cleanSuits[0] ?? null))
  return candidates.slice(0, 6)
}

/* ---------- точка входа ---------- */

export async function chooseActionSmart(
  round: RoundState,
  seat: Seat,
  level: BotLevel,
  ctx: SmartContext,
): Promise<RoundAction> {
  // Служебные ходы (Ок на прикуп, Ок на взятку, запись раздачи) — легаси.
  if (round.phase === "scored") return legacyAction(round, seat, level)
  if (round.phase === "declaring" && round.prikupAck.length < PLAYER_COUNT) {
    return legacyAction(round, seat, level)
  }
  if (round.phase === "play" && round.turn === null) return legacyAction(round, seat, level)

  const rng = rngFor(round, seat)
  const budgets = budgetsFor(level, ctx)
  try {
    switch (round.phase) {
      case "bidding":
        return await smartBid(round, seat, level, ctx, budgets, rng)
      case "declaring":
        return await smartDeclare(round, seat, level, ctx, budgets, rng)
      case "whist":
        return await smartWhist(round, seat, level, ctx, budgets, rng)
      case "play":
        return await smartPlay(round, seat, level, ctx, budgets, rng)
    }
  } catch (error) {
    if (!(error instanceof BudgetAbort)) throw error
  }
  return legacyAction(round, seat, level)
}

/* ---------- торговля ---------- */

async function smartBid(
  round: RoundState,
  seat: Seat,
  level: BotLevel,
  ctx: SmartContext,
  budgets: SmartBudgets,
  rng: () => number,
): Promise<RoundAction> {
  // Новичок торгуется по простым порогам: иначе он «внезапно слишком силён».
  if (level === "NOVICE") return legacyAction(round, seat, level)

  const highest = round.highest
  const misereLegal =
    highest === null || (!("kind" in highest.bid) && highest.bid.level === MIN_LEVEL)

  const geometry = dealGeometry(round, seat)
  if (!geometryConsistent(geometry)) return legacyAction(round, seat, level)
  const deals = sampleDeals(geometry, voidSuits(round), rng, budgets.samplesBid)
  if (deals.length === 0) return legacyAction(round, seat, level)

  const others = geometry.others
  const deadline = Date.now() + budgets.timeMs

  // EV распаса: своя рука против двух, соперники топят наше ожидание.
  const raspasCtx = solveCtxOf(round, seat, ctx, {
    contract: { kind: "raspas", level: 0, trump: "NT", declarer: null, whisters: [] },
  })
  const trumpSum = new Map<Trump, number>()
  const trumpN = new Map<Trump, number>()
  let passSum = 0
  let passN = 0
  let misereClean = 0
  let misereCaught = 0
  let misereCaughtTricks = 0

  for (let index = 0; index < deals.length; index += 1) {
    const deal = deals[index]
    let aborted = false

    const raspasState: SimState = {
      hands: seatHands(seat, [...round.hands[seat]], others, deal.hands),
      trick: [],
      turn: seat,
      trump: "NT",
      tricks: [0, 0, 0],
      tricksLeft: round.hands[seat].length,
    }
    try {
      passSum += searchSim(raspasState, raspasCtx, new Set([seat]), budgets.depth, {
        nodes: 0,
        deadline,
      })
      passN += 1
    } catch (error) {
      if (error instanceof BudgetAbort) aborted = true
      else throw error
    }

    if (!aborted) {
      // Потенциал каждой масти как козыря: снос подбираем по грубой оценке,
      // затем один точный поиск ожидаемых взяток.
      const full = [...round.hands[seat], ...deal.prikup]
      for (const trump of SUIT_TRUMPS) {
        const pairs = discardCandidates(full, trump, level === "MASTER")
        let bestHand: Card[] | null = null
        let bestPotential = Number.NEGATIVE_INFINITY
        for (const pair of pairs) {
          const rest = full.filter((card) => !pair.includes(card))
          const state: SimState = {
            hands: seatHands(seat, rest, others, deal.hands),
            trick: [],
            turn: seat,
            trump,
            tricks: [0, 0, 0],
            tricksLeft: rest.length,
          }
          const potential = seatPotential(state, seat)
          if (potential > bestPotential) {
            bestPotential = potential
            bestHand = rest
          }
        }
        if (!bestHand) continue
        const trickCtx: SolveCtx = {
          contract: { kind: "game", level: 0, trump, declarer: seat, whisters: [] },
          rules: ctx.rules,
          raspasStep: ctx.raspasStep,
          perspective: seat,
          mode: "declarerTricks",
        }
        const state: SimState = {
          hands: seatHands(seat, bestHand, others, deal.hands),
          trick: [],
          turn: seat,
          trump,
          tricks: [0, 0, 0],
          tricksLeft: bestHand.length,
        }
        try {
          const tricks = searchSim(state, trickCtx, new Set([seat]), budgets.depth, {
            nodes: 0,
            deadline,
          })
          trumpSum.set(trump, (trumpSum.get(trump) ?? 0) + tricks)
          trumpN.set(trump, (trumpN.get(trump) ?? 0) + 1)
        } catch (error) {
          if (error instanceof BudgetAbort) aborted = true
          else throw error
        }
        if (aborted) break
      }
    }

    if (!aborted && misereLegal) {
      const mfull = [...round.hands[seat], ...deal.prikup]
      if (misereDiscard(mfull, level === "MASTER")) {
        misereClean += 1
      } else {
        // Грубая оценка пойманных взяток: старшие карты без прикрытия.
        const guess = cardsToDiscard(mfull, "NT")
        const rest = mfull.filter((card) => !guess.includes(card))
        const state: SimState = {
          hands: seatHands(seat, rest, others, deal.hands),
          trick: [],
          turn: seat,
          trump: "NT",
          tricks: [0, 0, 0],
          tricksLeft: rest.length,
        }
        misereCaughtTricks += Math.max(0, Math.round(seatPotential(state, seat)))
        misereCaught += 1
      }
    }

    if (index % 4 === 3) await yieldToLoop()
    if (aborted) break
  }

  const passEv = passN > 0 ? passSum / passN : Number.NEGATIVE_INFINITY
  const candidates: Array<{ ev: number; action: RoundAction }> = [
    { ev: passEv, action: { type: "pass", seat } },
  ]

  if (misereLegal && misereClean + misereCaught > 0) {
    const total = misereClean + misereCaught
    const cleanRate = misereClean / total
    const misereOf = (mine: number): number =>
      utilityOfTricks(
        [0, 1, 2].map((s) => (s === seat ? mine : Math.round((10 - mine) / 2))),
        solveCtxOf(round, seat, ctx, {
          contract: { kind: "misere", level: 0, trump: "NT", declarer: seat, whisters: [] },
        }),
      )
    if (cleanRate >= 0.98) {
      candidates.push({ ev: misereOf(0), action: { type: "misere", seat } })
    } else if (misereCaught > 0) {
      const caught = Math.max(1, Math.round(misereCaughtTricks / misereCaught))
      candidates.push({
        ev: cleanRate * misereOf(0) + (1 - cleanRate) * misereOf(caught),
        action: { type: "misere", seat },
      })
    }
  }

  for (const trump of SUIT_TRUMPS) {
    const samples = trumpN.get(trump) ?? 0
    if (samples === 0) continue
    const expTricks = (trumpSum.get(trump) ?? 0) / samples
    const rivals = otherSeats(seat)
    for (let bidLevel = MIN_LEVEL; bidLevel <= MAX_LEVEL; bidLevel += 1) {
      if (highest && bidStrength({ level: bidLevel, trump }) <= bidStrength(highest.bid)) {
        continue
      }
      const mine = Math.max(0, Math.min(TRICKS_PER_ROUND, Math.round(expTricks)))
      const rest = TRICKS_PER_ROUND - mine
      const tricks = [0, 0, 0]
      tricks[seat] = mine
      tricks[rivals[0]] = Math.ceil(rest / 2)
      tricks[rivals[1]] = Math.floor(rest / 2)
      const ev = utilityOfTricks(tricks, solveCtxOf(round, seat, ctx, {
        contract: {
          kind: "game",
          level: bidLevel,
          trump,
          declarer: seat,
          // Консервативно: оба защитника вистуют.
          whisters: rivals,
        },
      }))
      if (!Number.isFinite(ev)) continue
      candidates.push({ ev, action: { type: "bid", seat, level: bidLevel, trump } })
    }
  }

  candidates.sort((left, right) => right.ev - left.ev)
  return candidates[0].action
}

/* ---------- прикуп и снос ---------- */

async function smartDeclare(
  round: RoundState,
  seat: Seat,
  level: BotLevel,
  ctx: SmartContext,
  budgets: SmartBudgets,
  rng: () => number,
): Promise<RoundAction> {
  if (level === "NOVICE") return legacyAction(round, seat, level)

  const hand = round.hands[seat]
  const highestBid = round.highest?.bid
  const auctionMisere = highestBid !== undefined && "kind" in highestBid
  const trump = highestBid && !("kind" in highestBid) ? highestBid.trump : "S"
  const misereAllowed =
    auctionMisere ||
    (highestBid !== undefined && !("kind" in highestBid) && highestBid.level === MIN_LEVEL)

  if (misereAllowed) {
    const plan = misereDiscard(hand, level === "MASTER")
    if (plan) return { type: "declare", seat, contract: "misere", discard: plan }
    if (auctionMisere) {
      // Мизер играется обязательно: снос с минимумом пойманных взяток.
      const pair = await leastCaughtDiscard(round, seat, hand, ctx, budgets, rng)
      return { type: "declare", seat, contract: "misere", discard: pair }
    }
  }

  const geometry = dealGeometry(round, seat)
  if (!geometryConsistent(geometry)) return legacyAction(round, seat, level)
  const deals = sampleDeals(geometry, voidSuits(round), rng, budgets.samples)
  if (deals.length === 0) return legacyAction(round, seat, level)
  if (!highestBid || "kind" in highestBid) return legacyAction(round, seat, level)

  // Заказ оставляют или поднимают. Кандидата на подъём даёт эвристика,
  // но решает симуляция: подъём идёт только когда по очкам он выгоднее
  // заказанной игры на одних и тех же сэмплах расклада.
  const raiseCandidate = declareRaise(hand, level, highestBid)
  const ordered = await evaluateDiscard(
    round, seat, hand, level, highestBid.level, trump, deals, geometry, ctx, budgets,
  )
  if (!ordered) return legacyAction(round, seat, level)

  if (raiseCandidate) {
    const raised = await evaluateDiscard(
      round, seat, hand, level, raiseCandidate.level, raiseCandidate.trump,
      deals, geometry, ctx, budgets,
    )
    if (raised && raised.ev > ordered.ev) {
      return {
        type: "declare",
        seat,
        contract: "game",
        discard: raised.pair,
        level: raiseCandidate.level,
        trump: raiseCandidate.trump,
      }
    }
  }
  return { type: "declare", seat, contract: "game", discard: ordered.pair }
}

/**
 * Снос под контракт: лучшая пара по сэмплам расклада и её средние очки.
 * null — сэмплирование не сошлось (бюджеты, пустые кандидаты).
 */
async function evaluateDiscard(
  round: RoundState,
  seat: Seat,
  hand: Card[],
  level: BotLevel,
  gameLevel: number,
  gameTrump: Trump,
  deals: ReturnType<typeof sampleDeals>,
  geometry: ReturnType<typeof dealGeometry>,
  ctx: SmartContext,
  budgets: SmartBudgets,
): Promise<{ pair: Card[]; ev: number } | null> {
  const pairs = discardCandidates(hand, gameTrump, level === "MASTER")
  if (pairs.length === 0) return null
  const buckets: Bucket<Card[]>[] = pairs.map((pair) => ({ subject: pair, sum: 0, n: 0 }))
  const deadline = Date.now() + budgets.timeMs
  let aborted = false

  for (let index = 0; index < deals.length && !aborted; index += 1) {
    const deal = deals[index]
    const snapshot = snapshotBuckets(buckets)
    for (const bucket of buckets) {
      const rest = hand.filter((card) => !bucket.subject.includes(card))
      const state: SimState = {
        hands: seatHands(seat, rest, geometry.others, deal.hands),
        trick: [],
        turn: seat,
        trump: gameTrump,
        tricks: [0, 0, 0],
        tricksLeft: rest.length,
      }
      try {
        bucket.sum += searchSim(
          state,
          solveCtxOf(round, seat, ctx, {
            contract: {
              kind: "game",
              level: gameLevel,
              trump: gameTrump,
              declarer: seat,
              // Консервативно: оба защитника вистуют.
              whisters: otherSeats(seat),
            },
          }),
          new Set([seat]),
          budgets.depth,
          { nodes: 0, deadline },
        )
        bucket.n += 1
      } catch (error) {
        if (error instanceof BudgetAbort) {
          aborted = true
          break
        }
        throw error
      }
    }
    if (aborted) rollbackBuckets(buckets, snapshot)
    if (index % 4 === 3) await yieldToLoop()
  }

  let bestPair: Card[] | null = null
  let bestEv = Number.NEGATIVE_INFINITY
  for (const bucket of buckets) {
    if (bucket.n > 0 && bucket.sum / bucket.n > bestEv) {
      bestEv = bucket.sum / bucket.n
      bestPair = bucket.subject
    }
  }
  return bestPair ? { pair: bestPair, ev: bestEv } : null
}

/** Снос под обязательный мизер: минимум ожидаемых (даже в худшем раскладе) взяток. */
async function leastCaughtDiscard(
  round: RoundState,
  seat: Seat,
  hand: Card[],
  ctx: SmartContext,
  budgets: SmartBudgets,
  rng: () => number,
): Promise<Card[]> {
  const geometry = dealGeometry(round, seat)
  if (!geometryConsistent(geometry)) {
    return cardsToDiscard(hand, "NT")
  }
  const deals = sampleDeals(geometry, voidSuits(round), rng, budgets.samples)
  if (deals.length === 0) return cardsToDiscard(hand, "NT")

  const pairs = discardCandidates(hand, "NT", false)
  const buckets: Bucket<Card[]>[] = pairs.map((pair) => ({ subject: pair, sum: 0, n: 0 }))
  const deadline = Date.now() + budgets.timeMs
  let aborted = false

  for (let index = 0; index < deals.length && !aborted; index += 1) {
    const deal = deals[index]
    const snapshot = snapshotBuckets(buckets)
    for (const bucket of buckets) {
      const rest = hand.filter((card) => !bucket.subject.includes(card))
      const state: SimState = {
        hands: seatHands(seat, rest, geometry.others, deal.hands),
        trick: [],
        turn: seat,
        trump: "NT",
        tricks: [0, 0, 0],
        tricksLeft: rest.length,
      }
      try {
        // Относительная оценка: наша гора за пойманные взятки против нуля соперников.
        bucket.sum += searchSim(
          state,
          solveCtxOf(round, seat, ctx, {
            contract: { kind: "misere", level: 0, trump: "NT", declarer: seat, whisters: [] },
          }),
          new Set([seat]),
          budgets.depth,
          { nodes: 0, deadline },
        )
        bucket.n += 1
      } catch (error) {
        if (error instanceof BudgetAbort) {
          aborted = true
          break
        }
        throw error
      }
    }
    if (aborted) rollbackBuckets(buckets, snapshot)
    if (index % 4 === 3) await yieldToLoop()
  }

  let bestPair = buckets.find((bucket) => bucket.n > 0)?.subject ?? pairs[0]
  let bestEv = Number.NEGATIVE_INFINITY
  for (const bucket of buckets) {
    if (bucket.n > 0 && bucket.sum / bucket.n > bestEv) {
      bestEv = bucket.sum / bucket.n
      bestPair = bucket.subject
    }
  }
  return bestPair
}

/* ---------- вист ---------- */

async function smartWhist(
  round: RoundState,
  seat: Seat,
  level: BotLevel,
  ctx: SmartContext,
  budgets: SmartBudgets,
  rng: () => number,
): Promise<RoundAction> {
  const contract = round.contract
  if (!contract || contract.kind !== "game") return { type: "whist", seat, whist: false }
  if (rng() < budgets.noise) {
    return { type: "whist", seat, whist: rng() < 0.5 }
  }

  const geometry = dealGeometry(round, seat)
  if (!geometryConsistent(geometry)) return legacyAction(round, seat, level)
  const deals = sampleDeals(geometry, voidSuits(round), rng, budgets.samples)
  if (deals.length === 0) return legacyAction(round, seat, level)

  const solve = solveCtxOf(round, seat, ctx)
  // Решение — разница ожиданий: вистую (свои висты в записи) против паса.
  // Пас считается на том же поиске с пустым списком вистующих.
  const solveWhist: SolveCtx = {
    ...solve,
    contract: { ...solve.contract, whisters: [seat] },
  }
  const maxSeats = maxSeatsFor(solve.contract, seat)
  const deadline = Date.now() + budgets.timeMs
  let sum = 0
  let n = 0
  let aborted = false

  for (let index = 0; index < deals.length && !aborted; index += 1) {
    const state = simFromRound(round, geometry.others, deals[index].hands, round.declarer ?? seat)
    try {
      const whistEv = searchSim(state, solveWhist, maxSeats, budgets.depth, { nodes: 0, deadline })
      const passEv = searchSim(state, solve, maxSeats, budgets.depth, { nodes: 0, deadline })
      sum += whistEv - passEv
      n += 1
    } catch (error) {
      if (error instanceof BudgetAbort) aborted = true
      else throw error
    }
    if (index % 6 === 5) await yieldToLoop()
  }
  if (n === 0) return legacyAction(round, seat, level)

  const ev = sum / n
  // Консервативно считаем, что партнёр пасует: ставка одиночного виста.
  const margin = level === "NOVICE" ? 1.2 : level === "PLAYER" ? 0.6 : 0.25
  return { type: "whist", seat, whist: ev > margin }
}

/* ---------- ход картой ---------- */

async function smartPlay(
  round: RoundState,
  seat: Seat,
  level: BotLevel,
  ctx: SmartContext,
  budgets: SmartBudgets,
  rng: () => number,
): Promise<RoundAction> {
  const hand = round.hands[seat]
  const legal = legalMoves(round, seat)
  if (legal.length === 0) return { type: "play", seat, card: hand[0] }
  if (legal.length === 1) return { type: "play", seat, card: legal[0] }
  if (rng() < budgets.noise) {
    const card = legal[Math.floor(rng() * legal.length)]
    return { type: "play", seat, card }
  }

  const geometry = dealGeometry(round, seat)
  if (!geometryConsistent(geometry)) return legacyAction(round, seat, level)
  const deals = sampleDeals(geometry, voidSuits(round), rng, budgets.samples)
  if (deals.length === 0) return legacyAction(round, seat, level)

  const solve = solveCtxOf(round, seat, ctx)
  const maxSeats = maxSeatsFor(solve.contract, seat)
  const buckets: Bucket<Card>[] = legal.map((card) => ({ subject: card, sum: 0, n: 0 }))
  const deadline = Date.now() + budgets.timeMs
  let aborted = false

  for (let index = 0; index < deals.length && !aborted; index += 1) {
    const state = simFromRound(round, geometry.others, deals[index].hands)
    const snapshot = snapshotBuckets(buckets)
    for (const bucket of buckets) {
      try {
        bucket.sum += searchSim(
          simAfterMove(state, seat, bucket.subject),
          solve,
          maxSeats,
          budgets.depth,
          { nodes: 0, deadline },
        )
        bucket.n += 1
      } catch (error) {
        if (error instanceof BudgetAbort) {
          aborted = true
          break
        }
        throw error
      }
    }
    if (aborted) rollbackBuckets(buckets, snapshot)
    if (index % 6 === 5) await yieldToLoop()
  }

  const evaluated = buckets.filter((bucket) => bucket.n > 0)
  if (evaluated.length === 0) return legacyAction(round, seat, level)

  const average = (bucket: Bucket<Card>): number => bucket.sum / bucket.n
  const bestEv = Math.max(...evaluated.map(average))
  const EPS = 0.02
  const tied = evaluated.filter((bucket) => average(bucket) >= bestEv - EPS).map((bucket) => bucket.subject)
  if (tied.length === 1) return { type: "play", seat, card: tied[0] }
  // Равное ожидание — решает легаси-эвристика: «минимально достаточная» карта
  // и другие привычные правила не тратят лишнего.
  const fallback = choosePlay(round, seat, hand, tied, level)
  return fallback.type === "play" ? fallback : { type: "play", seat, card: tied[0] }
}
