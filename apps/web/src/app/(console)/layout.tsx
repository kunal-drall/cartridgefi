import * as React from "react";
import { OnchainStatebar } from "@/components/OnchainStatebar";
import { BorelWalletProvider } from "@/components/wallet/WalletProvider";
import { ConsoleShellHeader } from "./_components/ConsoleShellHeader";
import { ConsoleVaultProvider } from "./_components/ConsoleVaultContext";
import { UnifiedCashierModal } from "./_components/UnifiedCashierModal";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <BorelWalletProvider>
      <ConsoleVaultProvider>
        <div className="min-h-screen bg-[#0b0c0e] text-[#f3f4f6]">
          <a
            href="#console-main-stage"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[#2563eb] focus:px-3 focus:py-1.5 focus:text-xs focus:font-medium focus:text-white"
          >
            Skip to main workspace
          </a>

          <ConsoleShellHeader />

          <main
            id="console-main-stage"
            className="mx-auto max-w-[1600px] px-4 pb-12 pt-4"
          >
            {children}
          </main>

          <OnchainStatebar className="fixed inset-x-0 bottom-0" />
          <UnifiedCashierModal />
        </div>
      </ConsoleVaultProvider>
    </BorelWalletProvider>
  );
}
