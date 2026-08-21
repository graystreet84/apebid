"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const WalletProviders = dynamic(() => import("./WalletProviders"), {
  ssr: false,
});

export function ClientProviders({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
