"use client";

import dynamic from "next/dynamic";

export const WalletButton = dynamic(
  () => import("./WalletButtonInner").then((m) => m.WalletButtonInner),
  {
    ssr: false,
    loading: () => (
      <span className="inline-block border border-white bg-hot px-3 py-1.5 text-sm font-bold text-black">
        wallet…
      </span>
    ),
  }
);
