# Copilot instructions for PrivaMarket

## Build, test, and lint commands

### Frontend (`app/`)
- Install deps: `cd app && npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Tests: no frontend test script is currently defined in `app/package.json`

### Contracts (`contracts/`)
- Build: `cd contracts && forge build`
- Full test suite: `forge test`
- Single test file: `forge test --match-path test/PrivateMarket.t.sol`
- Single test function: `forge test --match-test test_clearBatch_withMatchingOrders`
- Format check: `forge fmt --check`

## High-level architecture

- This repo is split into two active projects:
  - `app/`: Next.js App Router frontend plus an x402-protected API route.
  - `contracts/`: Foundry Solidity project for the market protocol.
- `app/src/app/layout.tsx` wraps the app with `Web3Provider`, which composes `wagmi`, `RainbowKit`, `@tanstack/react-query`, and `UnlinkProvider` on Monad testnet.
- Contract interaction is centralized in hooks (`app/src/hooks/usePrivateMarket.ts` and `app/src/hooks/useBatchAuction.ts`), then consumed by pages/components.
- `app/src/components/OrderForm.tsx` implements the primary trading flow:
  - default path places orders privately via Unlink burner accounts,
  - fallback path places public wallet transactions directly.
- `app/src/app/api/market-data/route.ts` applies an x402 micropaywall with lazy initialization, then falls back to direct JSON responses if facilitator/proxy setup is unavailable.
- `contracts/src/PrivateMarket.sol` is the core engine: market creation, batch order intake, batch clearing, order carry-forward, resolution, redemption, and cancellation.
- `contracts/src/PrivaUSD.sol` provides collateral via faucet; `contracts/src/OutcomeToken.sol` mints/burns only through `PrivateMarket`.
- `contracts/script/Deploy.s.sol` deploys both core contracts, attempts ERC-8004 registry registration, and seeds demo markets (matching the hackathon flow described in `SPEC.md`).

## Key conventions in this codebase

- Use network/address config from `app/src/lib/config.ts` (`CONTRACTS`, `monadTestnet`, `X402_CONFIG`) rather than hardcoding addresses.
  - Missing env values fall back to zero addresses, which leads to unusable writes.
- Use ABIs from `app/src/lib/contracts.ts`; UI hooks/components are written around these typed ABI constants.
- Price/value units are strict:
  - UI price inputs are percentages (1-99),
  - contract prices are basis points (0-10000),
  - token amounts use 18-decimal wei via `parseEther`/`formatEther`.
- Batch behavior is intentional product logic:
  - default batch interval is 5 seconds,
  - `BatchTimer` can auto-clear when ready and guarded by a ref to avoid duplicate clears,
  - single-sided batches are carried to the next batch instead of immediate refund.
- `contracts/lib/*` contains git submodules (`openzeppelin-contracts`, `forge-std`); treat them as external dependencies and avoid editing them during normal feature work.
