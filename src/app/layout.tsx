import type { Metadata } from "next"
import { Cormorant_Garamond, Inter } from "next/font/google"

import "./globals.css"

const displayFont = Cormorant_Garamond({
  subsets: ["cyrillic", "latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-display",
  display: "swap",
})

const sansFont = Inter({
  subsets: ["cyrillic", "latin"],
  variable: "--font-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Преферанс клуб · Ленинградка",
  description:
    "Камерный преферанс для друзей: стол открывается по ссылке, чат за столом, свечи по краям.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" className={`${displayFont.variable} ${sansFont.variable}`}>
      <body>{children}</body>
    </html>
  )
}