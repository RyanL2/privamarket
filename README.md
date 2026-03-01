# PrivaMarket

Private prediction markets on Monad with frequent batch auctions (FBA), Unlink privacy, and x402-powered market data.

> Hackathon project: Unlink x Monad (Feb 2026)

## What this project does

PrivaMarket lets users trade binary prediction markets without exposing their positions from their primary wallet address.

Core capabilities:
- **Private order flow** via Unlink burner accounts
- **Frequent Batch Auctions (FBA)** for batched, uniform-price execution
- **Pro-rata partial matching** when one side has more executable volume
- **Carry-forward of unfilled residuals** into the next batch
- **Cumulative market sentiment chart** (VWAP trendline + per-batch liquidity bars)
- **x402 paywalled API** for premium market data (`/api/market-data`)

## Repository structure

```text
.
├── app/          # Next.js frontend (App Router, wagmi/viem, RainbowKit, Unlink)
├── contracts/    # Foundry contracts, deploy script, tests
└── SPEC.md       # Product/system specification
```

## Tech stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Web3:** wagmi, viem, RainbowKit
- **Privacy:** `@unlink-xyz/react`
- **Contracts:** Solidity 0.8.24, Foundry
- **Data monetization:** x402 (`@x402/next`)
- **Network:** Monad testnet (`chainId: 10143`)

## Prerequisites

- Node.js 18+
- npm
- Foundry (`forge`, `cast`, `anvil`)

## Quick start

### 1) Install frontend dependencies

```bash
cd app
npm install
```

### 2) Configure frontend env

Create `app/.env.local`:

```bash
NEXT_PUBLIC_WC_PROJECT_ID=your_walletconnect_project_id
NEXT_PUBLIC_PRIVATE_MARKET_ADDRESS=0x...
NEXT_PUBLIC_WMON_ADDRESS=0x...
# Optional (for x402 paywall receiver)
TREASURY_ADDRESS=0x...
```

### 3) (Optional) Deploy contracts

Set shell env values:

```bash
export PRIVATE_KEY=0x...
export WMON_ADDRESS=0x...
```

Deploy:

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast --private-key $PRIVATE_KEY
```

### 4) Run the frontend

```bash
cd app
npm run dev
```

Open: `http://localhost:3000`

## Development commands

### Frontend (`app/`)

```bash
npm run dev
npm run build
npm run lint
```

### Contracts (`contracts/`)

```bash
forge build
forge test
forge test --match-path test/PrivateMarket.t.sol
forge test --match-test test_clearBatch_withMatchingOrders
forge fmt --check
```

## Contract overview

### `PrivateMarket.sol`

Main protocol contract:
- Market creation
- Batch order intake
- Batch clearing with deterministic candidate-price search
- Pro-rata partial fills for oversubscribed executable side
- Carry-forward of unfilled residual amounts
- Resolution + redemption
- Order cancellation for still-open orders

### `OutcomeToken.sol`

ERC-20 outcome tokens (`YES` / `NO`) mintable and burnable only by `PrivateMarket`.

## Frontend overview

Key areas:
- `app/src/components/OrderForm.tsx` – public/private order placement flow
- `app/src/components/BatchTimer.tsx` – batch readiness and clear trigger UX
- `app/src/components/PriceChart.tsx` – cumulative sentiment (VWAP) + liquidity bars
- `app/src/hooks/usePrivateMarket.ts` – typed contract reads/writes
- `app/src/hooks/useBatchAuction.ts` – batch state, executable-order gating

## Market data API (x402)

Endpoint:
- `GET /api/market-data`

Behavior:
- Tries x402 paywall via facilitator (`https://x402-facilitator.molandak.org`)
- Falls back to direct JSON response in demo/facilitator-unavailable mode

## Notes

- Address configuration defaults to zero-address placeholders if env values are missing; writes will not work until real addresses are set.
- See `SPEC.md` for full product rationale, architecture, and protocol details.
