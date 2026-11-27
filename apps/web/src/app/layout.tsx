import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CartridgeFi — On-Chain Market Execution & Ephemeral Rollup Terminal",
    template: "%s | CartridgeFi",
  },
  description:
    "Live multi-venue execution terminal and parameterized Ephemeral Rollup protocol on Solana and MagicBlock TEE. Trade and settle tokenized equities (NVDAx, SPYx, TSLAx), crypto markets, and Kalshi binary contracts.",
};

export const viewport: Viewport = {
  themeColor: "#0b0c0e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0b0c0e] text-[#f3f4f6] antialiased">
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#171a20",
              border: "1px solid #303642",
              color: "#f3f4f6",
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "13px",
            },
          }}
        />
      </body>
    </html>
  );
}
