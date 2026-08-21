import WalletGate from "@/components/WalletGate";
import { HomeClient } from "@/components/HomeClient";

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-3 pt-6 sm:px-4">
        <h1 className="text-center font-smash text-4xl leading-none text-white sm:text-6xl">
          Where will you be on the leaderboard when this goes viral?
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-yell">
          Pay SOL to rank Solana meme coins. Rank is the bid. Bid a token CA or
          pump.fun URL. Raise = the difference only. You stay until someone pays
          more.
        </p>
        <p className="mt-3 text-center">
          <a
            href="#bid-form"
            className="inline-block border-4 border-black bg-acid px-4 py-2 font-smash text-xl text-black no-underline"
          >
            Ape the board
          </a>
        </p>
        <p className="mt-2 text-center text-sm font-bold text-acid">
          0.05 SOL minimum
        </p>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm">
          New spots start at 0.05 SOL. Paying less than #1 still puts you on the
          board.
        </p>
        <p className="mx-auto mt-1 max-w-2xl text-center text-sm text-white/70">
          Already on the list? Same CA or pump.fun URL — you only pay the
          difference.
        </p>
      </section>
      <WalletGate>
        <HomeClient />
      </WalletGate>
    </>
  );
}
