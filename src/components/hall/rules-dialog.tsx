"use client"

import { useEffect, useRef, useState, type MouseEvent } from "react"

import {
  DEFAULT_RULESET,
  RULESET_LIMITS,
  normalizeRuleset,
  type Ruleset,
} from "@/lib/preference/rules"
import { rulesetSummary } from "@/lib/preference/score"

type Draft = {
  six: string
  seven: string
  eight: string
  nine: string
  ten: string
  misere: string
  shortfall: string
  whistSix: string
  whistHigh: string
  whistSingle: string
  raspasBase: string
  raspasGrowth: string
}

function draftFromRules(rules: Ruleset): Draft {
  return {
    six: String(rules.gameValues[6] ?? DEFAULT_RULESET.gameValues[6]),
    seven: String(rules.gameValues[7] ?? DEFAULT_RULESET.gameValues[7]),
    eight: String(rules.gameValues[8] ?? DEFAULT_RULESET.gameValues[8]),
    nine: String(rules.gameValues[9] ?? DEFAULT_RULESET.gameValues[9]),
    ten: String(rules.gameValues[10] ?? DEFAULT_RULESET.gameValues[10]),
    misere: String(rules.misereValue),
    shortfall: String(rules.shortfallFactor),
    whistSix: String(rules.whistRateSix),
    whistHigh: String(rules.whistRateHigh),
    whistSingle: String(rules.singleWhistRate),
    raspasBase: String(rules.raspasBase),
    raspasGrowth: String(rules.raspasGrowth),
  }
}

function rulesFromDraft(draft: Draft): Ruleset {
  return normalizeRuleset({
    gameValues: {
      6: draft.six,
      7: draft.seven,
      8: draft.eight,
      9: draft.nine,
      10: draft.ten,
    },
    misereValue: draft.misere,
    shortfallFactor: draft.shortfall,
    whistRateSix: draft.whistSix,
    whistRateHigh: draft.whistHigh,
    singleWhistRate: draft.whistSingle,
    raspasBase: draft.raspasBase,
    raspasGrowth: draft.raspasGrowth,
  })
}

/** Кнопка в форме создания стола: показывает текущие цифры. */
export function RulesTrigger({
  rules,
  onOpen,
}: {
  rules: Ruleset
  onOpen: () => void
}) {
  return (
    <button type="button" className="rules-trigger" onClick={onOpen}>
      <span className="rules-trigger__label">Правила и очки</span>
      <span className="rules-trigger__summary">{rulesetSummary(rules)}</span>
    </button>
  )
}

type RulesDialogProps = {
  open: boolean
  rules: Ruleset
  onOpenChange: (open: boolean) => void
  onApply: (rules: Ruleset) => void
}

/**
 * Все цифры пресета в одном окне. Живёт вне формы создания стола:
 * Enter в числовом поле не должен накрывать стол раньше времени.
 */
export function RulesDialog({
  open,
  rules,
  onOpenChange,
  onApply,
}: RulesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<Draft>(() => draftFromRules(rules))
  const [edited, setEdited] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const field =
    (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setEdited(true)
      setDraft((previous) => ({ ...previous, [key]: event.target.value }))
    }

  const apply = () => {
    onApply(rulesFromDraft(draft))
    onOpenChange(false)
  }

  const resetToPreset = () => {
    setEdited(true)
    setDraft(draftFromRules(DEFAULT_RULESET))
  }

  const preview = rulesFromDraft(draft)

  // Нативный <dialog> закрывается по Esc, но не по клику мимо окна — добавляем сами.
  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) onOpenChange(false)
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-label="Очки и правила стола"
      onClick={onBackdropClick}
      onClose={() => onOpenChange(false)}
    >
      <div className="dialog__body">
        <div>
          <h2 className="dialog__title">Очки и правила</h2>
          <p className="dialog__hint">
            {edited
              ? "Цифры видны всем за столом: поправьте и нажмите «Готово»."
              : "По умолчанию — привычная Ленинградка. Любую цифру можно поменять."}
          </p>
        </div>

        <div className="dialog__group">
          <span className="dialog__group-title">Игра в пулю</span>
          <div className="dialog__row dialog__row--5">
            <MiniField label="6 взяток" value={draft.six} onChange={field("six")} />
            <MiniField label="7" value={draft.seven} onChange={field("seven")} />
            <MiniField label="8" value={draft.eight} onChange={field("eight")} />
            <MiniField label="9" value={draft.nine} onChange={field("nine")} />
            <MiniField label="10" value={draft.ten} onChange={field("ten")} />
          </div>
        </div>

        <div className="dialog__group">
          <span className="dialog__group-title">Мизер и недобор</span>
          <div className="dialog__row dialog__row--2">
            <MiniField label="Мизер в пулю" value={draft.misere} onChange={field("misere")} />
            <MiniField
              label="Недобор × стоимость"
              value={draft.shortfall}
              onChange={field("shortfall")}
              max={RULESET_LIMITS.maxShortfallFactor}
            />
          </div>
        </div>

        <div className="dialog__group">
          <span className="dialog__group-title">Висты за взятку</span>
          <div className="dialog__row dialog__row--3">
            <MiniField label="На 6-й игре" value={draft.whistSix} onChange={field("whistSix")} />
            <MiniField label="На 7–10" value={draft.whistHigh} onChange={field("whistHigh")} />
            <MiniField
              label="Вистует один"
              value={draft.whistSingle}
              onChange={field("whistSingle")}
            />
          </div>
        </div>

        <div className="dialog__group">
          <span className="dialog__group-title">Распасы</span>
          <div className="dialog__row dialog__row--2">
            <MiniField
              label="Первый, за взятку"
              value={draft.raspasBase}
              onChange={field("raspasBase")}
            />
            <MiniField
              label="Насколько дорожают"
              value={draft.raspasGrowth}
              onChange={field("raspasGrowth")}
              max={RULESET_LIMITS.maxRaspasGrowth}
            />
          </div>
        </div>

        <p className="dialog__preview">{rulesetSummary(preview)}</p>

        <div className="dialog__foot">
          <button type="button" className="button button--ghost" onClick={resetToPreset}>
            Вернуть пресет
          </button>
          <button type="button" className="button" onClick={apply}>
            Готово
          </button>
        </div>
      </div>
    </dialog>
  )
}

function MiniField({
  label,
  value,
  onChange,
  max = RULESET_LIMITS.maxValue,
}: {
  label: string
  value: string
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  max?: number
}) {
  return (
    <label className="mini-field">
      <span className="mini-field__label">{label}</span>
      <input
        className="input input--number"
        type="number"
        inputMode="numeric"
        min={RULESET_LIMITS.minValue}
        max={max}
        step={1}
        value={value}
        onChange={onChange}
      />
    </label>
  )
}