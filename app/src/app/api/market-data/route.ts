import { NextRequest, NextResponse } from "next/server";

const X402_NETWORK = "eip155:10143";
const FACILITATOR_URL = "https://x402-facilitator.molandak.org";
const TREASURY = (process.env.TREASURY_ADDRESS ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;

// Lazy-initialize x402 proxy to avoid build-time facilitator fetch
let proxy: ((req: NextRequest) => Promise<NextResponse>) | null = null;

async function getProxy() {
  if (proxy) return proxy;
  try {
    const { paymentProxyFromConfig } = await import("@x402/next");
    proxy = paymentProxyFromConfig(
      {
        "/api/market-data": {
          accepts: {
            scheme: "exact" as const,
            price: "$0.001",
            network: X402_NETWORK,
            payTo: TREASURY,
          },
          description: "Premium market data: batch clearing results and order flow analytics",
        },
      },
      { url: FACILITATOR_URL } as any,
    );
    return proxy;
  } catch {
    return null;
  }
}

function getMarketData() {
  return {
    markets: [
      {
        id: 0,
        question: "Will Monad mainnet launch by Q3 2026?",
        yesPrice: 6500,
        noPrice: 3500,
        totalVolume: "50000000000000000000000",
        recentBatches: [
          {
            batchId: 0,
            clearingPrice: 6500,
            yesVolume: "10000000000000000000000",
            noVolume: "8000000000000000000000",
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        orderFlowSentiment: "bullish",
      },
      {
        id: 1,
        question: "Will ETH be above $5000 by end of 2026?",
        yesPrice: 4200,
        noPrice: 5800,
        totalVolume: "30000000000000000000000",
        recentBatches: [
          {
            batchId: 0,
            clearingPrice: 4200,
            yesVolume: "5000000000000000000000",
            noVolume: "6000000000000000000000",
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        orderFlowSentiment: "bearish",
      },
    ],
    timestamp: Math.floor(Date.now() / 1000),
  };
}

export async function GET(req: NextRequest) {
  // Try x402 paywall
  try {
    const p = await getProxy();
    if (p) return await p(req);
  } catch {
    // Facilitator unreachable — fall through to direct response
  }

  // Direct response (demo mode / facilitator down)
  return NextResponse.json(getMarketData());
}
