const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const kp = Keypair.generate();
const pub = kp.publicKey.toBase58();
const env = [
  '# PLACEHOLDER treasury — unused generated Keypair. NOT a real receive wallet.',
  'NEXT_PUBLIC_TREASURY_ADDRESS=' + pub,
  'DEV_FAKE_TX=true',
  'NEXT_PUBLIC_DEV_FAKE_TX=true',
  'NEXT_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com',
  ''
].join('\n');
fs.writeFileSync(path.join(__dirname, '..', '.env.local'), env);
fs.writeFileSync(path.join(__dirname, '..', '.env.example'), env);
console.log('PLACEHOLDER treasury', pub);
