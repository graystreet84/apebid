export default function Footer() {
  return (
    <footer className="mt-10 border-t-4 border-hot bg-black px-4 py-6 text-center">
      <div className="mb-2 space-x-3 text-sm">
        <a href="/">board</a>
        <span>·</span>
        <a href="/rules">rules</a>
      </div>
      <p className="text-lg font-bold text-yell">
        Original idea by{" "}
        <a
          href="https://x.com/jonathan_wilke"
          target="_blank"
          rel="noreferrer"
        >
          @jonathan_wilke
        </a>
      </p>
      <p className="mt-2 text-xs text-white/60">
        novelty leaderboard. not a financial product. not ape.lol. no swap
        embed. you stay until someone pays more.
      </p>
    </footer>
  );
}

export { Footer };
