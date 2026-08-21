"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const Providers = dynamic(() => import("./Providers"), { ssr: false });

export default function WalletGate({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
