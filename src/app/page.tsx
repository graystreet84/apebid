import WalletGate from "@/components/WalletGate";
import { HomeClient } from "@/components/HomeClient";

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-3 pt-5 sm:px-4 sm:pt-6">
        <h1 className="text-center font-smash text-3xl leading-tight text-white sm:text-5xl">
          Where will you be on the leaderboard when this goes viral?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-yell sm:text-base">
          Pay SOL to rank Solana meme coins. Rank is the bid. Bid a token CA or
          pump.fun URL. Raise = the difference only. You stay until someone pays
          more.
        </p>
        <p className="mt-3 text-center text-sm">
          <a href="#bid-form" className="text-acid no-underline hover:underline">
            Ape the board ↓
          </a>
        </p>
      </section>
      <WalletGate>
        <HomeClient />
      </WalletGate>
    </>
  );
}
