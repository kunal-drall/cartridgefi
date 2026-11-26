import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CartridgeFi — The Game Engine for Real Markets | Borel (#001)",
    template: "%s | CartridgeFi",
  },
  description:
    "Turn perps, prediction markets, and tokenized stocks into 10ms multiplayer games on Solana and MagicBlock Private Ephemeral Rollups. Play Borel (#001), Pulse Runner (#002), or vibe-code your own cartridge and keep 50% of builder fees.",
};

export const viewport: Viewport = {
  themeColor: "#050609",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${inter.variable} ${jetbrainsMono.variable} dark`}
    >
      <body className="min-h-screen bg-[#050609] text-slate-50 antialiased selection:bg-[#00F59B]/20 selection:text-[#00F59B]">
        {children}
      </body>
    </html>
  );
}
