// Фольклор преферансиста: реплики «за столом» и расклады, под которые они ложатся.
// Файл чистый: здесь только решение «подходит ли расклад под реплику».
// Само решение «сказать или промолчать», пауза и доставка в чат — на сервере
// (src/server/table-talk.ts).

import { rankOf, suitOf, type Trump } from "./cards"
import { PLAYER_COUNT } from "./constants"
import {
  bidStrength,
  otherSeats,
  type CompletedTrick,
  type RoundState,
  type Seat,
  type TrickCard,
} from "./round"
import { whistShortfall, type ScoreTable } from "./score"
import type { GameActionView, RoundResultView } from "../protocol"

/** Контракт предыдущей записанной раздачи — для «мизера ходят парами». */
export type RoundKind = RoundResultView["outcome"]["contract"]["kind"]

/** Всё, что компьютер видит в момент перехода стола, чтобы оценить расклад. */
export type TableTalkContext = {
  /** Номер раздачи, с единицы. */
  roundNumber: number
  /** Раздача после перехода; null — партия ещё не сдана. */
  round: RoundState | null
  /** События перехода: ставка, пас, вист, карта, взятка, раздача. */
  actions: GameActionView[]
  /** Итог раздачи, если этот переход её записал. */
  result: RoundResultView | null
  /** Таблица очков после перехода. */
  table: ScoreTable
  /** Раздача записана и все ждут ровно одного игрока. */
  awaitingOneReady: boolean
  /** Контракт предыдущей раздачи (память стола). */
  previousKind: RoundKind | null
}

export type TableTalkReplica = {
  id: string
  text: string
  /** Расклад, под который реплика ложится. */
  when: (ctx: TableTalkContext) => boolean
}

/** Склонность к болтовне: пока перевес в сторону «сказать». */
export const TABLE_TALK_SAY_CHANCE = 0.7

// ---------- общие подсказки для раскладов ----------

function had(ctx: TableTalkContext, type: GameActionView["type"]): boolean {
  return ctx.actions.some((action) => action.type === type)
}

function orderedBids(ctx: TableTalkContext): Array<{ level: number; trump: Trump }> {
  return ctx.actions.flatMap((action) =>
    action.type === "bid" && !("kind" in action.bid) ? [action.bid] : [],
  )
}

function misereBids(ctx: TableTalkContext): boolean {
  return ctx.actions.some((action) => action.type === "misere")
}

function declaredContracts(
  ctx: TableTalkContext,
): Array<Extract<GameActionView, { type: "declare" }>> {
  return ctx.actions.flatMap((action) =>
    action.type === "declare" ? [action] : [],
  )
}

function gameContract(
  ctx: TableTalkContext,
): { kind: "game"; level: number; trump: Trump } | null {
  const contract = ctx.round?.contract
  return contract?.kind === "game" ? contract : null
}

function passActions(ctx: TableTalkContext): Array<Extract<GameActionView, { type: "pass" }>> {
  return ctx.actions.flatMap((action) => (action.type === "pass" ? [action] : []))
}

function cardActions(ctx: TableTalkContext): Array<Extract<GameActionView, { type: "card" }>> {
  return ctx.actions.flatMap((action) => (action.type === "card" ? [action] : []))
}

function whistActions(ctx: TableTalkContext): Array<Extract<GameActionView, { type: "whist" }>> {
  return ctx.actions.flatMap((action) => (action.type === "whist" ? [action] : []))
}

/** Взятка, сошедшаяся этим переходом; без события «trick» — null. */
function settledTrick(ctx: TableTalkContext): CompletedTrick | null {
  if (!had(ctx, "trick")) return null
  return ctx.round?.history.at(-1) ?? null
}

function winnerCardOf(trick: CompletedTrick): TrickCard {
  return trick.cards.find((item) => item.seat === trick.winner) ?? trick.cards[0]
}

/** Недобор играющего на игровой контракте: сколько взяток не добрал. */
function declarerShortfall(ctx: TableTalkContext): number {
  const outcome = ctx.result?.outcome
  if (!outcome || outcome.contract.kind !== "game" || outcome.declarer === null) {
    return 0
  }
  const taken = outcome.tricks[outcome.declarer]
  return Math.max(0, outcome.contract.level - taken)
}

function isGamePodsat(ctx: TableTalkContext): boolean {
  return declarerShortfall(ctx) > 0
}

/** Взятки вистующих: одиночный вистует за себя и за пасующего (как в score.ts). */
function wonByWhisters(ctx: TableTalkContext): number[] {
  const outcome = ctx.result?.outcome
  if (!outcome || outcome.contract.kind !== "game" || outcome.declarer === null) {
    return []
  }
  const whisters = outcome.whisters
  return whisters.map((seat) => {
    let won = outcome.tricks[seat]
    if (whisters.length === 1) {
      const passer = otherSeats(outcome.declarer).find((item) => item !== seat)
      if (passer !== undefined) won += outcome.tricks[passer]
    }
    return won
  })
}

function misereResult(ctx: TableTalkContext): number {
  const outcome = ctx.result?.outcome
  if (!outcome || outcome.contract.kind !== "misere" || outcome.declarer === null) {
    return -1
  }
  return outcome.tricks[outcome.declarer]
}

function isRaspas(ctx: TableTalkContext): boolean {
  return ctx.result?.outcome.contract.kind === "raspas"
}

/** Мизер заявлен этим переходом: в торговле или объявлен после прикупа. */
function isMisereTalk(ctx: TableTalkContext): boolean {
  return (
    misereBids(ctx) ||
    declaredContracts(ctx).some((action) => action.contract === "misere")
  )
}

// ---------- каталог реплик ----------
// Порядок повторяет фольклорный список: торговля → прикуп → вист → ходы →
// взятки → расчёт раздачи → разговоры в паузе.

export const TABLE_TALK: TableTalkReplica[] = [
  // --- раздача ---
  {
    id: "fifth-under-table",
    text: "Пятого игрока — под стол!",
    when: (ctx) => had(ctx, "deal") && ctx.roundNumber === 1,
  },
  {
    id: "deal-then-smoke",
    text: "Сначала сдай, потом закуривай.",
    when: (ctx) => had(ctx, "deal") && ctx.roundNumber > 1,
  },

  // --- торговля ---
  {
    id: "six-diamonds",
    text: "Кто играет шесть бубен — тот бывает ... хм... обманут!",
    when: (ctx) =>
      orderedBids(ctx).some((bid) => bid.level === 6 && bid.trump === "D"),
  },
  {
    id: "seven-diamonds",
    text: "Кто играет семь бубён, тот бывает на…ён.",
    when: (ctx) =>
      orderedBids(ctx).some((bid) => bid.level === 7 && bid.trump === "D"),
  },
  {
    id: "seven-diamonds-variant",
    text: "Кто играет семь бубён — тот бывает посажён.",
    when: (ctx) =>
      orderedBids(ctx).some((bid) => bid.level === 7 && bid.trump === "D"),
  },
  {
    id: "jack-no-game",
    text: "Валет — игры нет.",
    when: (ctx) =>
      orderedBids(ctx).some((bid) => bid.level === 6 && bid.trump === "NT"),
  },
  {
    id: "orders-near",
    text: "Карты — ближе к орденам.",
    when: (ctx) => orderedBids(ctx).some((bid) => bid.level >= 9),
  },
  {
    id: "orders-curious",
    text: "Карты к орденам — партнёр любопытен!",
    when: (ctx) => orderedBids(ctx).some((bid) => bid.level >= 9),
  },
  {
    id: "brave-ten",
    text: "Трусы в карты не играют. Риск благородное дело.",
    when: (ctx) =>
      orderedBids(ctx).some((bid) => bid.level === 10) ||
      (whistActions(ctx).some((action) => action.whist) &&
        gameContract(ctx)?.level === 10),
  },
  {
    id: "seven-vobla",
    text: "7 к мизеру — что вобла к пиву.",
    when: misereBids,
  },
  {
    id: "hundred-grams",
    text: "Сто грамм к разбойнику, что вобла к пиву.",
    when: misereBids,
  },
  {
    id: "colonel",
    text: "Полковник был изрядной сукой, он спасовал на трёх тузах. Ему устроили науку: он девять взял на распасах.",
    when: (ctx) => passesOnThreeAces(ctx),
  },
  {
    id: "poruchik",
    text: "Поручик был изрядной сукой: он пасовал на трёх тузах и восемь брал на распасах.",
    when: (ctx) => passesOnThreeAces(ctx),
  },
  {
    id: "two-passes",
    text: "Два паса, в прикупе чудеса.",
    when: (ctx) =>
      passActions(ctx).length > 0 &&
      ctx.round?.phase === "bidding" &&
      (ctx.round?.bids.filter((bid) => bid === "pass").length ?? 0) === 2,
  },
  {
    id: "two-passes-sausage",
    text: "Два паса, в прикупе колбаса.",
    when: (ctx) =>
      passActions(ctx).length > 0 &&
      ctx.round?.phase === "bidding" &&
      (ctx.round?.bids.filter((bid) => bid === "pass").length ?? 0) === 2,
  },
  {
    id: "dealer-helps",
    text: "Сдал — помогай столу.",
    when: (ctx) =>
      passActions(ctx).length > 0 && ctx.round?.contract?.kind === "raspas",
  },
  {
    id: "cry-hearts",
    text: "Плачь больше — карта слезу любит.",
    when: (ctx) =>
      orderedBids(ctx).some((bid) => bid.trump === "H") ||
      declaredContracts(ctx).some((action) => action.trump === "H"),
  },

  // --- открытый прикуп ---
  {
    id: "neighbor-cards",
    text: "Первым делом посмотри карты соседа. Свои — всегда успеешь.",
    when: (ctx) =>
      had(ctx, "prikup-ack") && (ctx.round?.prikupAck.length ?? 0) >= PLAYER_COUNT,
  },
  {
    id: "smoke-more",
    text: "Дыми больше — партнёр дуреет.",
    when: (ctx) =>
      had(ctx, "prikup-ack") && (ctx.round?.prikupAck.length ?? 0) >= PLAYER_COUNT,
  },

  // --- снос и заказ ---
  {
    id: "prikup-good",
    text: "Хорошо прикупил — хорошо заложись.",
    when: (ctx) => raisedContract(ctx),
  },
  {
    id: "eight-order",
    text: "Лучше друг без двух, чем сам без одной.",
    when: (ctx) => gameContract(ctx)?.level === 8 && had(ctx, "declare"),
  },
  {
    id: "discard-trick",
    text: "Взятку снесёшь — без взятки останешься.",
    when: (ctx) =>
      declaredMisere(ctx) &&
      (ctx.round?.discard.some((card) => rankOf(card) === "A" || rankOf(card) === "K") ??
        false),
  },
  {
    id: "discard-trick-seat",
    text: "Взятку снесть — без взятки сесть.",
    when: (ctx) =>
      declaredMisere(ctx) &&
      (ctx.round?.discard.some((card) => rankOf(card) === "A" || rankOf(card) === "K") ??
        false),
  },
  {
    id: "hostess",
    text: "За хозяйками в прикуп не ходят. (Хозяйка — семёрка на мизере).",
    when: (ctx) =>
      declaredMisere(ctx) &&
      (ctx.round?.discard.some((card) => rankOf(card) === "7") ?? false),
  },
  {
    id: "sochi",
    text: "Знал бы прикуп — жил бы в Сочи.",
    when: (ctx) =>
      declaredContracts(ctx).some((action) => action.contract === "game") &&
      (ctx.round?.prikup.some((card) => rankOf(card) === "A") ?? false),
  },
  {
    id: "two-spades",
    text: "Две пики — не одна пика.",
    when: prikupTwoSpades,
  },
  {
    id: "two-spades-prikup",
    text: "Две пики приходят ему, две пики ему ни к чему.",
    when: prikupTwoSpades,
  },
  {
    id: "four-four-story",
    text: "Нет повести печальней в этом мире, чем козыри четыре—на—четыре.",
    when: (ctx) => trumpsFourFour(ctx),
  },
  {
    id: "four-four-layout",
    text: "Нет расклада «лучше» в мире, чем четыре на четыре.",
    when: (ctx) => trumpsFourFour(ctx),
  },

  // --- вист ---
  {
    id: "no-lead-no-whist",
    text: "Нет хода — не вистуй.",
    when: (ctx) => whistActions(ctx).some((action) => !action.whist),
  },
  {
    id: "no-tricks-no-whist",
    text: "Нет взяток — не вистуй, партнёр тоже вистанёт.",
    when: (ctx) => passedOnWhistWithPartner(ctx),
  },
  {
    id: "whist-nine-grooms",
    text: "Распасы — игра мужская. На девятерной вистуют только женихи и студенты.",
    when: (ctx) =>
      whistActions(ctx).some((action) => action.whist) &&
      gameContract(ctx)?.level === 9,
  },
  {
    id: "whist-nine-priests",
    text: "На девятерной вистуют только попы и студенты. Студенты по глупости, а попы из жадности.",
    when: (ctx) =>
      whistActions(ctx).some((action) => action.whist) &&
      gameContract(ctx)?.level === 9,
  },
  {
    id: "whist-nine-armavir",
    text: "На девятерной вистуют только попы, студенты, женихи и начальник станции Армавир.",
    when: (ctx) =>
      whistActions(ctx).some((action) => action.whist) &&
      gameContract(ctx)?.level === 9,
  },
  {
    id: "whist-no-greed",
    text: "Вистуй без жадности, не перебивай взятки соседа.",
    when: (ctx) => pairedWhist(ctx),
  },
  {
    id: "lay-cards",
    text: "Перед вистующим клади карты, не задумывайся.",
    when: (ctx) => soloWhistFormed(ctx),
  },
  {
    id: "dark-invite",
    text: "Приглашён втёмную — береги длинную масть.",
    when: (ctx) => soloWhistFormed(ctx),
  },

  // --- ходы ---
  {
    id: "lead-diamonds",
    text: "Хода нет — ходи с бубей. Нет бубей — ходи с червей.",
    when: (ctx) => openingLead(ctx)?.suit === "D",
  },
  {
    id: "lead-seven-ace",
    text: "Под игрока — с семака. Под вистующего — с тузующего.",
    when: (ctx) => tacticalLead(ctx),
  },
  {
    id: "lead-seven-ace-short",
    text: "Под вистуза — с туза, под игрока — с семака.",
    when: (ctx) => tacticalLead(ctx),
  },
  {
    id: "lead-long-suit",
    text: "Под вистующего с большой и длинной масти.",
    when: (ctx) => tacticalLead(ctx, "declarer"),
  },
  {
    id: "lead-short-suit",
    text: "Под играющего — с маленькой и короткой масти.",
    when: (ctx) => tacticalLead(ctx, "defender"),
  },
  {
    id: "lead-seven-ace-full",
    text: "Под игрока — с семака короткой масти без туза, под вистующего — с тузующего.",
    when: (ctx) => tacticalLead(ctx),
  },
  {
    id: "enemy-eight",
    text: "При чужом ходе на мизере восьмёрка — твой враг.",
    when: (ctx) =>
      ctx.round?.contract?.kind === "misere" &&
      cardActions(ctx).some(
        (action) =>
          action.seat === ctx.round?.declarer && rankOf(action.card) === "8",
      ),
  },

  // --- взятки ---
  {
    id: "third-queen",
    text: "Уважай третью даму.",
    when: (ctx) => rankOfTrickWinner(ctx) === "Q",
  },
  {
    id: "queens-third",
    text: "Дам надо уважать, особенно третьих.",
    when: (ctx) => rankOfTrickWinner(ctx) === "Q",
  },
  {
    id: "jack-not-figure",
    text: "Валет не фигура — бей дамой.",
    when: (ctx) => queenBeatsJack(ctx),
  },
  {
    id: "queen-any-side",
    text: "Дама бьётся и своя, и чужая.",
    when: (ctx) => queensInARow(ctx),
  },
  {
    id: "queen-any-side-variant",
    text: "Даму бей свою и чужую.",
    when: (ctx) => queensInARow(ctx),
  },
  {
    id: "weak-knock",
    text: "Слабо стукнешь — не возьмёшь.",
    when: (ctx) => {
      const rank = rankOfTrickWinner(ctx)
      return rank === "8" || rank === "9"
    },
  },
  {
    id: "cut-with-high",
    text: "Прорезали — бей старшей.",
    when: (ctx) => aceOfLedSuit(ctx),
  },
  {
    id: "jack-queen-ace",
    text: "Валет для дамы, дама для туза.",
    when: (ctx) => aceOverFigures(ctx),
  },
  {
    id: "trump-in-sleeve",
    text: "Есть ещё козырь в козырницах!",
    when: (ctx) => ruffed(ctx),
  },

  // --- расчёт раздачи ---
  {
    id: "mistakes-happen",
    text: "Ошибки случаются — карты не стеклянные.",
    when: (ctx) => declarerShortfall(ctx) === 1,
  },
  {
    id: "no-discard-top-two",
    text: "За игру без сноса — на верху без двух.",
    when: (ctx) => declarerShortfall(ctx) === 2,
  },
  {
    id: "table-enemies",
    text: "Скатерть, вино и жена — злейшие враги преферанса.",
    when: (ctx) => declarerShortfall(ctx) >= 3,
  },
  {
    id: "worst-enemies",
    text: "Злейшие враги преферанса — жена, скатерть, шум и жадность.",
    when: (ctx) => declarerShortfall(ctx) >= 3,
  },
  {
    id: "sit-and-fight",
    text: "Сел — не расстраивайся, а отыгрывайся умеючи.",
    when: (ctx) => isGamePodsat(ctx),
  },
  {
    id: "released-declarer",
    text: "Выпустил играющего — залез в свой карман.",
    when: (ctx) => declarerSucceeded(ctx) && (ctx.result?.outcome.whisters.length ?? 0) === 0,
  },
  {
    id: "plant-the-whister",
    text: "Не сумел посадить играющего — посади вистующего.",
    when: (ctx) =>
      declarerSucceeded(ctx) &&
      whistShortfall(
        ctx.result?.outcome.contract.kind === "game"
          ? ctx.result.outcome.contract.level
          : 6,
        wonByWhisters(ctx),
      ).some((shortfall) => shortfall > 0),
  },
  {
    id: "whist-hero",
    text: "Пуля дура, вист молодец!",
    when: (ctx) =>
      declarerShortfall(ctx) > 0 &&
      wonByWhisters(ctx).reduce((sum, won) => sum + won, 0) >= 5,
  },
  {
    id: "american-help",
    text: "Помогая партнеру, фактически ты его раздеваешь — это и есть американская помощь.",
    when: (ctx) =>
      declarerShortfall(ctx) > 0 &&
      wonByWhisters(ctx).reduce((sum, won) => sum + won, 0) >= 5,
  },
  {
    id: "first-remise",
    text: "Первый ремиз — золото.",
    when: (ctx) => ctx.roundNumber === 1 && firstRemise(ctx),
  },
  {
    id: "misere-joy",
    text: "Мизер в дом — радость в дом!",
    when: (ctx) => misereResult(ctx) === 0,
  },
  {
    id: "not-preferansist",
    text: "Тот не преферансист кто ни разу не завалился на мизере.",
    when: (ctx) => misereResult(ctx) > 0,
  },
  {
    id: "misere-tram",
    text: "Мизер как трамвай — один ушёл, придёт другой.",
    when: (ctx) => misereResult(ctx) > 0,
  },
  {
    id: "luck-by-morning",
    text: "Карта не лошадь — к утру повезет.",
    when: (ctx) => isRaspas(ctx) && (ctx.result?.outcome.tricks.some((taken) => taken >= 4) ?? false),
  },
  {
    id: "luck-nicotine",
    text: "Карта не лошадь, никотином не убьёшь.",
    when: (ctx) => isRaspas(ctx) && (ctx.result?.outcome.tricks.some((taken) => taken >= 4) ?? false),
  },
  {
    id: "grab-yours",
    text: "На распасовке хватай свои, иначе всё дадут.",
    when: (ctx) => isRaspas(ctx) && (ctx.result?.outcome.tricks.some((taken) => taken >= 4) ?? false),
  },
  {
    id: "think-an-hour",
    text: "Больше часа не думать!",
    when: (ctx) => ctx.table.raspasStep >= 3 && ctx.result !== null,
  },
  {
    id: "think-an-hour-short",
    text: "Больше часа не думай.",
    when: (ctx) => ctx.table.raspasStep >= 3 && ctx.result !== null,
  },
  {
    id: "dont-win-always",
    text: "Не выигрывай каждый раз — потеряешь партнёров.",
    when: (ctx) => leaderLead(ctx) >= 20,
  },
  {
    id: "high-class",
    text: "Преферансист, как и спортсмен, должен быть высокого класса. Слабые обычно проигрывают.",
    when: (ctx) => leaderLead(ctx) >= 20,
  },
  {
    id: "no-money",
    text: "Нет денег — не садись. (Впрочем, не садиться лучше и при деньгах.)",
    when: (ctx) => ctx.table.entries.some((entry) => entry.mountain >= 20),
  },
  {
    id: "no-money-short",
    text: "Нет денег — не садись.",
    when: (ctx) => ctx.table.entries.some((entry) => entry.mountain >= 20),
  },
  {
    id: "smart-mountain",
    text: "Умный в гору не пойдёт...",
    when: (ctx) => (ctx.result?.deltas.some((delta) => delta.mountain >= 4) ?? false),
  },
  {
    id: "no-alpinist",
    text: "Игрок не альпинист — сам в гору не пойдет.",
    when: (ctx) => (ctx.result?.deltas.some((delta) => delta.mountain >= 4) ?? false),
  },
  {
    id: "unlucky-love",
    text: "Не везёт в карты — в любовь даже и не суйся!",
    when: (ctx) => (ctx.result?.deltas.some((delta) => delta.mountain >= 6) ?? false),
  },
  {
    id: "keep-calm",
    text: "Держи себя в руках. Нервничай после расплаты.",
    when: (ctx) => (ctx.result?.deltas.some((delta) => delta.mountain >= 6) ?? false),
  },
  {
    id: "bullet-dream",
    text: "Мечта преферансиста: чтобы пуля догнала гору.",
    when: (ctx) =>
      ctx.table.entries.some(
        (entry) => entry.mountain >= 8 && entry.pool >= entry.mountain,
      ),
  },
  {
    id: "interesting-friends",
    text: "Познаешь преферанс — приобретёшь интересных друзей.",
    when: (ctx) => ctx.result?.finished === true,
  },

  // --- пауза перед следующей раздачей ---
  {
    id: "not-a-date",
    text: "Пуля не свидание — не опаздывай.",
    when: (ctx) => ctx.awaitingOneReady,
  },
  {
    id: "not-a-date-start",
    text: "Пулька не свидание — к началу не опаздывай.",
    when: (ctx) => ctx.awaitingOneReady,
  },
  {
    id: "misere-pairs",
    text: "Мизера ходят парами.",
    when: (ctx) => isMisereTalk(ctx) && ctx.previousKind === "misere",
  },
]

// ---------- расклады, использующиеся больше одного раза ----------

/** Пас на трёх тузах: сервер видит руки, но реплика никого не выдаёт. */
function passesOnThreeAces(ctx: TableTalkContext): boolean {
  for (const action of passActions(ctx)) {
    const hand = ctx.round?.hands[action.seat] ?? []
    if (hand.filter((card) => rankOf(card) === "A").length >= 3) return true
  }
  return false
}

/** Заказ подняли после прикуса: прикуп пришёл удачный. */
function raisedContract(ctx: TableTalkContext): boolean {
  if (!had(ctx, "declare")) return false
  const contract = gameContract(ctx)
  const highest = ctx.round?.highest
  if (!contract || !highest || "kind" in highest.bid) return false
  return bidStrength(contract) > bidStrength(highest.bid)
}

/** Прикуп — две пики: играющему идут, но и ни к чему. */
function prikupTwoSpades(ctx: TableTalkContext): boolean {
  const prikup = ctx.round?.prikup
  return (
    declaredContracts(ctx).some((action) => action.contract === "game") &&
    (prikup?.length === 2 && prikup.every((card) => suitOf(card) === "S"))
  )
}

function declaredMisere(ctx: TableTalkContext): boolean {
  return declaredContracts(ctx).some((action) => action.contract === "misere")
}

/** Козыри легли четыре—на—четыре: считаем по финальным рукам защитников. */
function trumpsFourFour(ctx: TableTalkContext): boolean {
  const contract = gameContract(ctx)
  const round = ctx.round
  if (!contract || contract.trump === "NT" || !round || round.declarer === null) {
    return false
  }
  if (!had(ctx, "declare")) return false
  const counts = otherSeats(round.declarer).map(
    (seat) => round.hands[seat].filter((card) => suitOf(card) === contract.trump).length,
  )
  return counts.length === 2 && counts.every((count) => count === 4)
}

function defenderSeats(ctx: TableTalkContext): Seat[] {
  const declarer = ctx.round?.declarer
  return declarer === null || declarer === undefined ? [] : otherSeats(declarer)
}

/** Пас на висте, когда партнёр уже вистует. */
function passedOnWhistWithPartner(ctx: TableTalkContext): boolean {
  const round = ctx.round
  const whist = round?.whist
  if (!round || !whist) return false
  const defenders = defenderSeats(ctx)
  if (defenders.length !== 2) return false
  const [left, right] = defenders
  return whistActions(ctx).some(
    (action) =>
      !action.whist &&
      ((action.seat === left && whist[right] === true) ||
        (action.seat === right && whist[left] === true)),
  )
}

/** Вистуют оба защитника: вист без жадности, взятки соседа не перебивать. */
function pairedWhist(ctx: TableTalkContext): boolean {
  if (!had(ctx, "whist")) return false
  const defenders = defenderSeats(ctx)
  const whist = ctx.round?.whist
  if (defenders.length !== 2 || !whist) return false
  const [left, right] = defenders
  return whist[left] === true && whist[right] === true
}

/** Одиночный вист сложился: один вистует, другой пасует. */
function soloWhistFormed(ctx: TableTalkContext): boolean {
  if (!had(ctx, "whist")) return false
  const defenders = defenderSeats(ctx)
  const whist = ctx.round?.whist
  if (defenders.length !== 2 || !whist) return false
  const [left, right] = defenders
  const decisions = [whist[left], whist[right]]
  return (
    decisions.every((decision) => decision !== null) &&
    decisions.filter((decision) => decision === true).length === 1
  )
}

type OpeningLead = { suit: ReturnType<typeof suitOf>; seat: Seat; card: string }

/** Первая карта раздачи (не заход прикупа). */
function openingLead(ctx: TableTalkContext): OpeningLead | null {
  const round = ctx.round
  if (!round || round.history.length > 0 || !had(ctx, "card")) return null
  const lead = round.trick[0]
  if (!lead || lead.fromPrikup) return null
  return { suit: suitOf(lead.card), seat: lead.seat, card: lead.card }
}

/**
 * Тактический заход: под играющего — с семака, под вистующего — с туза.
 * `who` сужает расклад для вариаций реплики.
 */
function tacticalLead(
  ctx: TableTalkContext,
  who?: "declarer" | "defender",
): boolean {
  const round = ctx.round
  const lead = round?.trick[0]
  if (!round || !lead || lead.fromPrikup || !had(ctx, "card")) return false
  const isDeclarerLead = round.declarer !== null && lead.seat === round.declarer
  if (who === "declarer" && !isDeclarerLead) return false
  if (who === "defender" && isDeclarerLead) return false
  return isDeclarerLead
    ? rankOf(lead.card) === "A"
    : rankOf(lead.card) === "7"
}

function rankOfTrickWinner(ctx: TableTalkContext): string | null {
  const trick = settledTrick(ctx)
  if (!trick) return null
  return rankOf(winnerCardOf(trick).card)
}

/** Дама побила валета той же масти. */
function queenBeatsJack(ctx: TableTalkContext): boolean {
  const trick = settledTrick(ctx)
  if (!trick) return false
  const winner = winnerCardOf(trick)
  if (rankOf(winner.card) !== "Q") return false
  return trick.cards.some(
    (item) => suitOf(item.card) === suitOf(winner.card) && rankOf(item.card) === "J",
  )
}

/** Последние две взятки взяты дамами. */
function queensInARow(ctx: TableTalkContext): boolean {
  const history = ctx.round?.history ?? []
  if (!had(ctx, "trick") || history.length < 2) return false
  const lastTwo = history.slice(-2)
  return lastTwo.every((trick) => rankOf(winnerCardOf(trick).card) === "Q")
}

/** Туз взял взятку в масти хода: прорезали — бей старшей. */
function aceOfLedSuit(ctx: TableTalkContext): boolean {
  const trick = settledTrick(ctx)
  if (!trick) return false
  const winner = winnerCardOf(trick)
  return suitOf(winner.card) === suitOf(trick.cards[0].card) && rankOf(winner.card) === "A"
}

/** Туз взял взятку, а в взятке были валет или дама его масти. */
function aceOverFigures(ctx: TableTalkContext): boolean {
  const trick = settledTrick(ctx)
  if (!trick) return false
  const winner = winnerCardOf(trick)
  if (rankOf(winner.card) !== "A") return false
  return trick.cards.some(
    (item) =>
      suitOf(item.card) === suitOf(winner.card) &&
      (rankOf(item.card) === "J" || rankOf(item.card) === "Q"),
  )
}

/** Взятку взял козырь на чужой масти: козырница ещё не пуста. */
function ruffed(ctx: TableTalkContext): boolean {
  const trick = settledTrick(ctx)
  if (!trick) return false
  if (gameContract(ctx) === null) return false
  const winner = winnerCardOf(trick)
  return suitOf(winner.card) !== suitOf(trick.cards[0].card)
}

function declarerSucceeded(ctx: TableTalkContext): boolean {
  const outcome = ctx.result?.outcome
  if (!outcome || outcome.contract.kind !== "game" || outcome.declarer === null) {
    return false
  }
  return outcome.tricks[outcome.declarer] >= outcome.contract.level
}

function firstRemise(ctx: TableTalkContext): boolean {
  if (isGamePodsat(ctx)) return true
  return misereResult(ctx) > 0
}

function leaderLead(ctx: TableTalkContext): number {
  const pools = [...ctx.table.entries.map((entry) => entry.pool)].sort(
    (left, right) => right - left,
  )
  return (pools[0] ?? 0) - (pools[1] ?? 0)
}

// ---------- выбор реплики ----------

/** Все реплики, чей расклад сошёлся с ситуацией, в порядке каталога. */
export function matchTableTalk(ctx: TableTalkContext): TableTalkReplica[] {
  return TABLE_TALK.filter((replica) => {
    try {
      return replica.when(ctx)
    } catch {
      // Кривой расклад не должен ломать переход стола.
      return false
    }
  })
}
