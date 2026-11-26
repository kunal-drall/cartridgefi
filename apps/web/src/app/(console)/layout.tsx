import * as React from "react";
import { ConsoleShellHeader } from "./_components/ConsoleShellHeader";
import { ConsoleVaultProvider } from "./_components/ConsoleVaultContext";
import { UnifiedCashierModal } from "./_components/UnifiedCashierModal";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ConsoleVaultProvider>
      <div className="min-h-screen bg-[#050609] text-slate-50">
        <a
          href="#console-main-stage"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-[#00F59B] focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:font-bold focus:text-[#050609]"
        >
          Skip to Console Stage
        </a>

        <ConsoleShellHeader />

        <main
          id="console-main-stage"
          className="mx-auto max-w-[1440px] px-3 pb-16 pt-4 sm:px-6 sm:pt-6"
        >
          {children}
        </main>

        <UnifiedCashierModal />
      </div>
    </ConsoleVaultProvider>
  );
}
