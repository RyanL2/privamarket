# PrivaMarket: Private Prediction Market on Monad

> Ship Private. Ship Fast. — Unlink x Monad Hackathon (Feb 27 – Mar 1, 2026)

## System Overview

PrivaMarket is a prediction market where positions are private. Users bet on binary outcomes without revealing which side they took. The system uses:

- **Frequent Batch Auctions (FBA)** — eliminates MEV/frontrunning by collecting orders into time-windowed batches and clearing at a uniform price
- **Unlink Privacy SDK** — shields user positions via burner accounts funded from a shielded pool
- **Monad Blockchain** — high-throughput L1 with parallel execution for fast batch clearing
- **x402 Protocol** — monetizes aggregated market data behind a micropaywall
- **ERC-8004** — agent identity registration for on-chain resolver pattern

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Market Views  │  │  Order Form  │  │   Unlink Wallet       │ │
│  │ (list/trade)  │  │  (buy/sell)  │  │   (shield/unshield)   │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
│         │                 │                       │             │
│  ┌──────┴─────────────────┴───────────────────────┴───────────┐ │
│  │              wagmi + viem (Monad RPC)                       │ │
│  └──────────────────────┬─────────────────────────────────────┘ │
│                         │                                       │
│  ┌──────────────────────┴─────────────────────────────────────┐ │
│  │           Unlink SDK (burner accounts, shielded pool)      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │     Monad Testnet          │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │   PrivateMarket.sol   │  │
                    │  │   (FBA engine)        │  │
                    │  └──────────┬───────────┘  │
                    │             │               │
                    │  ┌──────────┴───────────┐  │
                    │  │  OutcomeToken.sol     │  │
                    │  │  (YES/NO ERC-20)      │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │  WMON (ERC-20)       │  │
                    │  │  (Wrapped MON Coll.) │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │  Unlink ERC-20 Pool   │  │
                    │  │  (privacy layer)      │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │  ERC-8004 Registry    │  │
                    │  │  (agent identity)     │  │
                    │  └──────────────────────┘  │
                    └────────────────────────────┘
```

## Smart Contract Specifications

### OutcomeToken.sol

Standard ERC-20 token with minting/burning restricted to the PrivateMarket contract.

- One token deployed per market per outcome (YES token, NO token)
- `mint(address to, uint256 amount)` — only callable by PrivateMarket
- `burn(address from, uint256 amount)` — only callable by PrivateMarket
- Fully compatible with Unlink's ERC-20 pool (standard approve/transfer)

### WMON (Wrapped MON Collateral)

WMON is the ERC-20 collateral token used by the market and Unlink pool.

- Canonical WMON address is configured and passed into `PrivateMarket`
- Public user UX can stay MON-native by wrapping to WMON in the frontend flow
- Compatible with Unlink's ERC-20 pool

### PrivateMarket.sol

The core FBA engine and market logic.

**State:**

```solidity
struct Market {
    string question;
    uint256 resolutionTime;
    address yesToken;
    address noToken;
    address creator;
    Outcome resolved;         // UNRESOLVED, YES, NO
    uint256 currentBatchId;
    uint256 batchInterval;    // 5 seconds default
    uint256 lastClearTime;
    uint256 collateralPool;   // Total WMON collateral held
    address collateralToken;  // WMON address
}

struct Order {
    address trader;
    Side side;        // YES or NO
    uint256 price;    // Basis points (0-10000 = 0%-100%)
    uint256 amount;   // Collateral amount in wei
    bool filled;
}

mapping(uint256 => Market) public markets;
mapping(uint256 => mapping(uint256 => Order[])) public batchOrders;
uint256 public nextMarketId;
```

**Functions:**

| Function | Access | Description |
|----------|--------|-------------|
| `createMarket(string question, uint256 resolutionTime, uint256 batchInterval)` | Public | Creates market, deploys YES/NO tokens |
| `placeOrder(uint256 marketId, Side side, uint256 price, uint256 amount)` | Public | Adds order to current batch (requires WMON approval) |
| `clearBatch(uint256 marketId)` | Public | Runs FBA clearing for completed batch |
| `resolve(uint256 marketId, Outcome outcome)` | Admin | Resolves market outcome |
| `redeem(uint256 marketId, uint256 amount)` | Public | Burns winning tokens, receives WMON |

**FBA Clearing Algorithm:**

1. Collect all orders in the completed batch
2. Sort YES orders descending by price, NO orders ascending by price
3. Build cumulative demand curves for both sides
4. Find crossing point = clearing price
5. Fill YES orders at or above clearing price
6. Fill NO orders at or below (10000 - clearing price)
7. Mint YES/NO tokens to filled traders at clearing price
8. Refund unfilled orders
9. Invariant: YES price + NO price = 10000 (100%)

### IERC8004.sol (Stub)

Interface for ERC-8004 Identity Registry at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.

- `register()` — registers the deployer as a resolver agent
- No actual resolution logic — demonstrates the pattern for hackathon

## Privacy Model

### Problem
Standard prediction markets expose all positions on-chain. Anyone can see who bet what, enabling:
- Social pressure / retaliation for controversial positions
- Front-running of large orders
- Position copying by sophisticated traders

### Solution: Unlink Burner Pattern

```
┌─────────────────────────────────────────────────┐
│                  User's Main Wallet              │
│                                                  │
│  1. Wrap MON to WMON (public tx)                 │
│  2. Deposit WMON into Unlink pool (shields)      │
└──────────────────────┬──────────────────────────-┘
                       │ shielded
                       ▼
┌─────────────────────────────────────────────────┐
│              Unlink Shielded Pool                │
│                                                  │
│  Balances are hidden. No on-chain link between   │
│  deposits and withdrawals.                       │
└──────────────────────┬──────────────────────────-┘
                       │ fund burner
                       ▼
┌─────────────────────────────────────────────────┐
│               Burner Account                     │
│                                                  │
│  3. Created via Unlink SDK (deterministic index) │
│  4. Funded with WMON from shielded pool          │
│  5. Approves WMON → PrivateMarket                │
│  6. Calls placeOrder(marketId, side, price, amt) │
│  7. Waits for batch clearing                     │
│  8. Receives YES/NO tokens                       │
│  9. Sweeps tokens back to shielded pool          │
└─────────────────────────────────────────────────┘
```

**Privacy guarantees:**
- On-chain observers see burner addresses placing orders, not the user's main wallet
- Each order can use a fresh burner — no linkability between orders
- Unlink's ZK proofs ensure funds in the shielded pool cannot be traced
- Batch clearing further obscures individual order details

### Redemption Flow

```
1. Create new burner account
2. Fund burner with winning tokens from shielded pool
3. Burner calls redeem(marketId, amount)
4. Burner receives WMON (unwrap to MON if needed)
5. Sweep WMON back to shielded pool
```

## API Reference (x402)

### GET /api/market-data

Premium market data endpoint protected by x402 micropaywall.

**Payment:**
- Price: $0.001 per query (USDC)
- Network: `eip155:10143` (Monad Testnet)
- Facilitator: `https://x402-facilitator.molandak.org`
- USDC: `0x534b2f3A21130d7a60830c2Df862319e593943A3`

**Response:**
```json
{
  "markets": [
    {
      "id": 0,
      "question": "Will Monad mainnet launch by Q3 2026?",
      "yesPrice": 6500,
      "noPrice": 3500,
      "totalVolume": "50000000000000000000000",
      "recentBatches": [
        {
          "batchId": 12,
          "clearingPrice": 6500,
          "yesVolume": "1000000000000000000000",
          "noVolume": "800000000000000000000",
          "timestamp": 1709234567
        }
      ],
      "orderFlowSentiment": "bullish"
    }
  ],
  "timestamp": 1709234600
}
```

## Deployment Guide

### Prerequisites
- Foundry (Monad fork recommended)
- Node.js 18+
- Monad testnet RPC: `https://testnet-rpc.monad.xyz`
- Testnet MON from faucet

### Deploy Contracts
```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast --private-key $PRIVATE_KEY
```

### Run Frontend
```bash
cd app
npm install
npm run dev
```

### Environment Variables
```
NEXT_PUBLIC_PRIVATE_MARKET_ADDRESS=<deployed address>
NEXT_PUBLIC_WMON_ADDRESS=<deployed address>
NEXT_PUBLIC_MONAD_RPC=https://testnet-rpc.monad.xyz
PRIVATE_KEY=<deployer private key>
WMON_ADDRESS=<canonical WMON address for deployment script>
TREASURY_ADDRESS=<x402 payment recipient>
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Blockchain | Monad Testnet | High-throughput L1 with parallel execution |
| Smart Contracts | Solidity + Foundry | FBA engine, token management |
| Privacy | Unlink SDK (canary) | Shielded balances, burner accounts |
| Frontend | Next.js + React | Server-rendered market UI |
| Wallet | wagmi + viem | Wallet connection and contract interaction |
| Data Monetization | x402 Protocol | Micropaywall for market data |
| Identity | ERC-8004 | Agent identity registration |

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@unlink-xyz/react` | canary | Frontend privacy hooks |
| `@unlink-xyz/node` | canary | Backend privacy (optional) |
| `@x402/next` | latest | x402 paywall middleware |
| `@x402/core` | latest | x402 core types |
| `@x402/evm` | latest | EVM scheme for x402 |
| `viem` | 2.40.0+ | Monad RPC compatibility |
| `wagmi` | latest | React wallet hooks |
| `next` | latest | Frontend framework |
| Foundry | latest | Contract development |

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Unlink SDK instability (canary) | Test SDK integration first; graceful fallbacks |
| FBA clearing gas limits | Reasonable batch sizes; Monad parallel execution |
| ZK proof generation (5-30s) | Loading states with progress indicators |
| x402 facilitator downtime | Bypass flag for demo |
| ERC-8004 interaction failure | Stub pattern; document if registration fails |
