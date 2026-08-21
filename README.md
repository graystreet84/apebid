# apebid.lol

Pay SOL to rank Solana meme coins. Rank is the bid.

## How to run

cd /workspace/apebid
cp .env.example .env.local
npm install
npx next dev --port 3000

Use 3001 if 3000 is taken. Preview on this box: http://localhost:3001

## Env

NEXT_PUBLIC_TREASURY_ADDRESS = PLACEHOLDER unused Keypair (not Chris)
# SOLANA_RPC = optional server-only URL (never NEXT_PUBLIC_ for paid keys)
DEV_FAKE_TX=true
NEXT_PUBLIC_DEV_FAKE_TX=true

## Blockers

- Placeholder treasury (Chris receive-wallet missing)
- Vercel auth not done
- Domain DNS / do not buy apebid.lol
- File store will not persist on Vercel
- Fake-tx is on for local preview

Promo drafts in promo/. Do not post. Credit @jonathan_wilke.
