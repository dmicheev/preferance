import Image from "next/image"
import type { CSSProperties } from "react"

// Пылинки в тёплом свете: позиции фиксированы, чтобы сервер и клиент рисовали одно и то же.
const MOTES = [
  { left: "11%", bottom: "22%", delay: "0s", duration: "28s", size: 3 },
  { left: "23%", bottom: "34%", delay: "-7s", duration: "34s", size: 2 },
  { left: "37%", bottom: "16%", delay: "-14s", duration: "31s", size: 3 },
  { left: "52%", bottom: "28%", delay: "-3s", duration: "26s", size: 2 },
  { left: "66%", bottom: "20%", delay: "-19s", duration: "37s", size: 3 },
  { left: "79%", bottom: "30%", delay: "-11s", duration: "29s", size: 2 },
  { left: "90%", bottom: "24%", delay: "-23s", duration: "33s", size: 3 },
]

export function Ambience() {
  return (
    <div className="ambience" aria-hidden="true">
      <div className="ambience__warmth" />
      <CognacStill />
      {MOTES.map((mote) => (
        <span
          key={mote.left}
          className="mote"
          style={
            {
              left: mote.left,
              bottom: mote.bottom,
              width: mote.size,
              height: mote.size,
              animationDelay: mote.delay,
              animationDuration: mote.duration,
            } as CSSProperties
          }
        />
      ))}
      <div className="ambience__grain" />
      <div className="ambience__vignette" />
    </div>
  )
}

/**
 * Натюрморт в углу: бутылка коньяка и два бокала. Фотография, а не рисунок —
 * тёмное стекло на чёрном фоне вырезано по ключу, притушено под свет свечей и
 * посажено на тёплую лужицу света, чтобы не висеть в воздухе.
 */
function CognacStill() {
  return (
    <div className="ambience__still">
      <Image
        src="/still/cognac-still.webp"
        alt=""
        width={1000}
        height={1039}
        unoptimized
        draggable={false}
      />
    </div>
  )
}
