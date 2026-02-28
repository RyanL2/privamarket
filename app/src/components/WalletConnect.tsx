"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function WalletConnect() {
  return <ConnectButton showBalance={true} chainStatus="icon" accountStatus="address" />;
}
