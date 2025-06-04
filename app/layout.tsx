import type React from "react"
import type { Metadata } from "next"
// import { Inter } from "next/font/google"
import "./globals.css"

// const inter = Inter({ 
  // subsets: ["latin"],
// })

export const metadata: Metadata = {
  title: "Mini TFD Control",
  description: "Desktop application for controlling mini TFD devices",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      {/* <body className={`${inter.className} font-sans`}>{children}</body> */}
      <body className="sans-serif">{children}</body>
    </html>
  )
}
