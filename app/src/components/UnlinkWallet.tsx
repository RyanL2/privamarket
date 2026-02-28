"use client";

import { useState } from "react";
import { useUnlink, useUnlinkBalance, useBurner, useDeposit } from "@unlink-xyz/react";
import { useAccount, useWalletClient } from "wagmi";
import { CONTRACTS } from "@/lib/config";
import { PRIVAUSD_ABI } from "@/lib/contracts";
import { parseEther, formatEther, encodeFunctionData } from "viem";

export default function UnlinkWallet() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const {
    walletExists,
    createWallet,
    importWallet,
    ready,
    busy,
    status,
    error,
    clearError,
  } = useUnlink();

  const { balance: shieldedPusd } = useUnlinkBalance(CONTRACTS.PRIVAUSD);
  const { deposit: doDeposit, isPending: isDepositing } = useDeposit();
  const { burners, createBurner } = useBurner();

  const [mnemonic, setMnemonic] = useState("");
  const [showMnemonic, setShowMnemonic] = useState("");
  const [depositAmount, setDepositAmount] = useState("100");
  const [importInput, setImportInput] = useState("");

  const handleCreate = async () => {
    try {
      const result = await createWallet();
      setShowMnemonic(result.mnemonic);
    } catch (e) {
      console.error("Failed to create wallet:", e);
    }
  };

  const handleImport = async () => {
    if (!importInput.trim()) return;
    try {
      await importWallet(importInput.trim());
    } catch (e) {
      console.error("Failed to import wallet:", e);
    }
  };

  const handleDeposit = async () => {
    if (!address || !walletClient) return;
    try {
      // First approve PrivaUSD to Unlink pool
      const amount = parseEther(depositAmount);
      // Execute deposit through Unlink
      const result = await doDeposit([
        { token: CONTRACTS.PRIVAUSD, amount, depositor: address },
      ]);

      // Submit the relay transaction on-chain if needed
      if (result && "calldata" in result) {
        await walletClient.sendTransaction({
          to: result.to as `0x${string}`,
          data: result.calldata as `0x${string}`,
          value: result.value ? BigInt(result.value) : 0n,
        });
      }
    } catch (e) {
      console.error("Deposit failed:", e);
    }
  };

  const handleCreateBurner = async () => {
    try {
      const index = burners.length;
      await createBurner(index);
    } catch (e) {
      console.error("Burner creation failed:", e);
    }
  };

  if (!address) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-lg font-semibold text-white/60">Privacy Wallet</h3>
        <p className="mt-2 text-sm text-white/40">Connect your wallet first</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Privacy Wallet</h3>
        {ready && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400 flex justify-between">
          <span>{error.message}</span>
          <button onClick={clearError} className="text-red-300 hover:text-white">&times;</button>
        </div>
      )}

      {busy && (
        <div className="text-sm text-amber-400 animate-pulse">{status || "Processing..."}</div>
      )}

      {!walletExists ? (
        <div className="space-y-3">
          <p className="text-sm text-white/50">Create or import an Unlink privacy wallet to start trading privately.</p>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:opacity-50 py-2.5 text-sm font-medium text-white transition"
          >
            Create Privacy Wallet
          </button>

          <div className="flex items-center gap-2 text-white/30 text-xs">
            <div className="flex-1 h-px bg-white/10" />
            or
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <div className="flex gap-2">
            <input
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              placeholder="Enter mnemonic phrase..."
              className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={handleImport}
              disabled={busy || !importInput.trim()}
              className="rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 px-4 py-2 text-sm text-white transition"
            >
              Import
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {showMnemonic && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-xs text-amber-400 font-medium mb-1">Save your mnemonic (shown once):</p>
              <p className="text-xs text-white font-mono break-all">{showMnemonic}</p>
              <button
                onClick={() => setShowMnemonic("")}
                className="mt-2 text-xs text-amber-400 hover:text-amber-300"
              >
                I&apos;ve saved it
              </button>
            </div>
          )}

          {/* Shielded Balance */}
          <div className="rounded-lg bg-white/5 p-3">
            <div className="text-xs text-white/40 mb-1">Shielded PrivaUSD</div>
            <div className="text-2xl font-bold text-white font-mono">
              {formatEther(shieldedPusd ?? 0n)}
              <span className="text-sm text-white/40 ml-1">PUSD</span>
            </div>
          </div>

          {/* Deposit */}
          <div className="flex gap-2">
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Amount"
              className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={handleDeposit}
              disabled={busy || isDepositing}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition"
            >
              {isDepositing ? "Shielding..." : "Shield"}
            </button>
          </div>

          {/* Burners */}
          <div className="border-t border-white/10 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-white/60">Burner Accounts</span>
              <button
                onClick={handleCreateBurner}
                disabled={busy}
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                + New Burner
              </button>
            </div>
            {burners.length === 0 ? (
              <p className="text-xs text-white/30">No burners yet. Create one to trade privately.</p>
            ) : (
              <div className="space-y-1">
                {burners.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono text-white/50">
                    <span className="text-white/30">#{i}</span>
                    <span>{b.address.slice(0, 10)}...{b.address.slice(-6)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
