"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, http } from "wagmi";
import { RainbowKitProvider, getDefaultConfig, darkTheme } from "@rainbow-me/rainbowkit";
import { UnlinkProvider } from "@unlink-xyz/react";
import { monadTestnet, UNLINK_CHAIN } from "@/lib/config";
import "@rainbow-me/rainbowkit/styles.css";

const config = getDefaultConfig({
  appName: "PrivaMarket",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "placeholder",
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(monadTestnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export default function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#7c3aed", accentColorForeground: "white", borderRadius: "medium" })}>
          <UnlinkProvider chain={UNLINK_CHAIN} syncInterval={45000}>
            {children}
          </UnlinkProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
