"use client"

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react"

import { CHAT_MAX_LENGTH, type ChatMessageView } from "@/lib/protocol"

type ChatDockProps = {
  messages: ChatMessageView[]
  myNickname: string | null
  onlineCount: number
  error: string | null
  disabled: boolean
  onSend: (text: string) => void
}

const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
})

export function ChatDock({
  messages,
  myNickname,
  onlineCount,
  error,
  disabled,
  onSend,
}: ChatDockProps) {
  const [text, setText] = useState("")
  // Время сообщений показываем только после гидратации: часовой пояс клиента
  // может не совпадать с серверным.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText("")
  }

  return (
    <aside className="dock" aria-label="Разговор за столом">
      <div className="dock__head">
        <div className="dock__title">
          <b>Разговор</b>
          <span>
            {onlineCount > 0
              ? `${onlineCount} за столом`
              : "ждём подключения"}
          </span>
        </div>
      </div>

      <div className="dock__messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="dock__empty">
            Пока тихо. Скажи что-нибудь — только не подсказывай.
          </p>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className="message"
              data-mine={message.nickname === myNickname}
            >
              <div className="message__meta">
                <span className="message__author">{message.nickname}</span>
                {hydrated ? (
                  <time className="message__time">
                    {TIME_FORMAT.format(new Date(message.at))}
                  </time>
                ) : null}
              </div>
              <p className="message__text">{message.text}</p>
            </article>
          ))
        )}
      </div>

      {error ? <p className="form-error" style={{ margin: "0 14px 10px" }}>{error}</p> : null}

      <form className="dock__form" onSubmit={submit}>
        <input
          className="input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={disabled ? "Сначала сядь за стол" : "Сказать за столом…"}
          disabled={disabled}
          aria-label="Текст сообщения"
        />
        <button
          className="dock__send"
          type="submit"
          disabled={disabled || text.trim().length === 0}
          aria-label="Отправить сообщение"
        >
          →
        </button>
      </form>

      <div className="dock__voice">
        <b>Голос</b>
        <span>
          WebRTC-стол — следующий этап: сначала правила и стол, потом голос.
        </span>
      </div>
    </aside>
  )
}