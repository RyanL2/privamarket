import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

export const UNLINK_CHAIN = "monad-testnet" as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Contract addresses — update after deployment
export const CONTRACTS = {
  PRIVATE_MARKET: (process.env.NEXT_PUBLIC_PRIVATE_MARKET_ADDRESS ?? ZERO_ADDRESS) as `0x${string}`,
  WMON: (process.env.NEXT_PUBLIC_WMON_ADDRESS ?? ZERO_ADDRESS) as `0x${string}`,
  USDC_MONAD: "0x534b2f3A21130d7a60830c2Df862319e593943A3" as `0x${string}`,
  IDENTITY_REGISTRY: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as `0x${string}`,
} as const;

export function isConfiguredAddress(address: `0x${string}`): boolean {
  return address.toLowerCase() !== ZERO_ADDRESS;
}

export const X402_CONFIG = {
  facilitator: "https://x402-facilitator.molandak.org",
  network: "eip155:10143",
} as const;
