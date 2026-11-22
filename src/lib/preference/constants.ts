// Константы преферанса: 3 игрока за столом, четвёртый сдаёт по кругу.

export const PLAYER_COUNT = 3
export const TRICKS_PER_ROUND = 10

/** Минимальный и максимальный заказ в торговле. */
export const MIN_LEVEL = 6
export const MAX_LEVEL = 10

/** Все уровни заказа по возрастанию. */
export const GAME_LEVELS = [6, 7, 8, 9, 10] as const

export const MIN_BID = MIN_LEVEL * 10
export const MAX_BID = MAX_LEVEL * 10 + 4