import type { CSSProperties } from "react"

import type { Contract } from "./preference/round"
import type { GameSettingsView } from "./protocol"

const VARIANT_LABELS: Record<GameSettingsView["variant"], string> = {
  LENINGRADKA: "Ленинградка",
  SOCHINKA: "Сочинка",
}

const LEVEL_ORDINALS: Record<number, string> = {
  6: "шестерная",
  7: "семерная",
  8: "восьмерная",
  9: "девятерная",
  10: "десятная",
}

export function variantLabel(variant: GameSettingsView["variant"]): string {
  return VARIANT_LABELS[variant]
}

export function roundsLabel(roundsLimit: number | null): string {
  return roundsLimit ? `до ${roundsLimit} раздач` : "без лимита раздач"
}

/** Короткая строка настроек для верхней панели стола. */
export function settingsSummary(settings: GameSettingsView): string {
  return [
    variantLabel(settings.variant),
    `пуля ${settings.bullet}`,
    roundsLabel(settings.roundsLimit),
  ].join(" · ")
}

export function statusLabel(status: "LOBBY" | "PLAYING" | "FINISHED"): string {
  switch (status) {
    case "LOBBY":
      return "Лобби"
    case "PLAYING":
      return "Идёт игра"
    case "FINISHED":
      return "Игра закончена"
  }
}

export function deckStyle(rotate: number, arc = 0): CSSProperties {
  return { "--rotate": `${rotate}deg`, "--arc": `${arc}px` } as CSSProperties
}

/** Контракт по-человечески: «шестерная в пиках», «мизер», «распасы». */
export function contractLabel(contract: Contract): string {
  switch (contract.kind) {
    case "game": {
      const name = LEVEL_ORDINALS[contract.level] ?? `${contract.level} взяток`
      return contract.trump === "NT"
        ? `${name} без козыря`
        : `${name} в ${CONTRACT_SUITS[contract.trump]}`
    }
    case "misere":
      return "Мизер"
    case "raspas":
      return "Распасы"
  }
}

const CONTRACT_SUITS: Record<string, string> = {
  S: "пиках",
  H: "червях",
  D: "бубнах",
  C: "трефах",
}