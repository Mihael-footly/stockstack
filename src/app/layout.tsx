import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockStack — Stack the Market",
  description:
    "Stack stock blocks, clear lines, and build your portfolio. A free browser block-stacking game where every piece is a stock.",
  applicationName: "StockStack",
  openGraph: {
    title: "StockStack — Stack the Market",
    description: "Stack stock blocks, clear lines, and build your portfolio.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#04090F",
  width: "device-width",
  initialScale: 1,
  // The board is driven by drag gestures; a pinch-zoom mid-game is never intended.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          Press Start 2P is the arcade voice of the whole interface. It is used
          for headings, labels and buttons only — never for a paragraph, where
          its width and lack of real lowercase would cost more than it gives.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
