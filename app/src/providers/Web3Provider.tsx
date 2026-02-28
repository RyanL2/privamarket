"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { RainbowKitProvider, getDefaultConfig, darkTheme } from "@rainbow-me/rainbowkit";
import { UnlinkProvider } from "@unlink-xyz/react";
import { monadTestnet } from "@/lib/config";
import "@rainbow-me/rainbowkit/styles.css";

const config = getDefaultConfig({
  appName: "PrivaMarket",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "placeholder",
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(monadTestnet.rpcUrls.default.http[0]),
  },
});

const queryClient = new QueryClient();

export default function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#7c3aed", accentColorForeground: "white", borderRadius: "medium" })}>
          <UnlinkProvider chain="monad-testnet">
            {children}
          </UnlinkProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
