import WalletGate from "@/components/WalletGate";
import { HomeClient } from "@/components/HomeClient";

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-3 pt-5 sm:px-4 sm:pt-6">
        <h1 className="smash-hero text-center font-smash text-3xl text-white sm:text-5xl">
          Promote your favorite memecoin. Rule the board.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-yell">
          Not a token. No contract address. The board is the product.
        </p>
        <p className="mt-1 text-center text-xs text-white/55">Not ape.lol.</p>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-white/75 sm:text-base">
          Pay SOL to rank Solana meme coins. Rank is the bid. Bid a token CA or
          pump.fun URL. Raise = the difference only. You stay until someone pays
          more.
        </p>
      </section>
      <WalletGate>
        <HomeClient />
      </WalletGate>
    </>
  );
}
