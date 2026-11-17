# Tycoon Table

A 3D property-trading board game for the web: roll, buy, build and bargain on a toy-like tabletop.
Live: https://tycoon-table.vercel.app

- Real 3D board in Three.js: brick townhouses, window-lit hotel towers, metallic tokens (car, ship, cat, dog, rocket, crown, plane, robot), rolling dice and flying gold coins.
- Every rent, tax and fine is paid by counting coins into a tray.
- Full rules engine: auctions, even building, mortgages with interest, jail, trading and bankruptcy, with atomic transactions and a complete transaction history.
- Five AI personalities (Conservative Investor, Aggressive Investor, Strategic Builder, Smart Trader, Balanced Player).
- Local pass-and-play for 2 to 6 players, a guided tutorial, and a layout that works down to phone width.
- No backend: the current game and settings are saved in localStorage. Installable as a PWA.

All names, places and branding in the game are original.

## Develop

```sh
npm install
npm run dev        # Vite dev server
npm test           # Vitest engine tests
npm run typecheck
npm run build      # static site in dist/
```

`node tools/shots.mjs` captures the portfolio screenshots (prototype/shots, prototype/web.jpg): it plays four AI players
with the real engine to a mid-game position, saves it and resumes it in headless Chrome.

## Deploy

Vercel project connected to this repo: every push to `main` deploys production (`vercel.json` builds with `npm run build` and serves `dist/`).
The Android app is a Capacitor shell that opens the live site, built with `~/Documents/android-wrappers/build-remote.sh`.
