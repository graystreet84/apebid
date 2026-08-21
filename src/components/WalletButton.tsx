"use client";

import dynamic from "next/dynamic";

export const WalletButton = dynamic(
  () => import("./WalletButtonInner").then((m) => m.WalletButtonInner),
  {
    ssr: false,
    loading: () => (
      <span className="inline-block border-2 border-white bg-hot px-3 py-2 text-black font-bold">
        wallet…
      </span>
    ),
  }
);
