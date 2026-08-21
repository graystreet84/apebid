export default function RulesPage() {
  return (
    <main className="mx-auto max-w-2xl px-3 py-8 sm:px-4 sm:py-12">
      <p className="mb-6 text-xs uppercase tracking-widest text-ape-pink">
        <a href="/">← board</a>
      </p>
      <h1 className="font-display text-4xl text-ape-acid">/rules</h1>
      <p className="mt-4 text-lg">
        apebid.lol is a novelty leaderboard. It is not a financial product.
      </p>

      <h2 className="mt-10 font-display text-2xl text-ape-pink">How it works</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6">
        <li>Bid in SOL on a Solana token contract address or a pump.fun URL.</li>
        <li>
          Rank is the bid. Highest bid is #1. Paying less still puts you on the
          board at whatever rank that bid can take.
        </li>
        <li>Minimum bid is 0.05 SOL.</li>
        <li>
          Already on the board? Enter the same CA or URL and raise. You only pay
          the difference. Someone else cannot take your rank by paying only that
          difference.
        </li>
        <li>
          A confirmed SOL transfer claims the rank. Nothing is reserved while you
          connect a wallet.
        </li>
        <li>You stay until someone outbids you. Rank is not time-limited.</li>
      </ol>

      <h2 className="mt-10 font-display text-2xl text-ape-pink">What you get</h2>
      <p className="mt-3">
        A public row: token, bid, clicks. Clicks go to the page you submitted.
      </p>
      <p className="mt-3 text-ape-mute">
        You do not get traffic guarantees, holder guarantees, price support, or
        an endorsement. Slots are paid visibility. That is the whole product.
      </p>

      <h2 className="mt-10 font-display text-2xl text-ape-pink">What this is not</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6">
        <li>Not financial advice.</li>
        <li>Not a launchpad, DEX, or brokerage.</li>
        <li>We do not auto-embed a swap.</li>
        <li>Meme coins can go to zero.</li>
        <li>No refunds. Confirmed bids stay on the board.</li>
      </ul>

      <h2 className="mt-10 font-display text-2xl text-ape-pink">Banned (obvious spam)</h2>
      <p className="mt-3">
        Invite links (Telegram, Discord, WhatsApp). NSFW. Link shorteners. Stuff
        that is not a token CA or a pump.fun URL.
      </p>

      <h2 className="mt-10 font-display text-2xl text-ape-pink">Credit</h2>
      <p className="mt-3">
        Original idea by{" "}
        <a href="https://x.com/jonathan_wilke" target="_blank" rel="noreferrer">
          @jonathan_wilke
        </a>{" "}
        — outbid.lol. We cloned the mechanic and pointed it at Solana meme coins.
      </p>
    </main>
  );
}
