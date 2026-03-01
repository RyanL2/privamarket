"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useUnlink, useBurner } from "@unlink-xyz/react";
import { CONTRACTS } from "@/lib/config";
import { PRIVATEMARKET_ABI, PRIVAUSD_ABI } from "@/lib/contracts";
import { parseEther, encodeFunctionData } from "viem";

interface OrderFormProps {
  marketId: number;
  question: string;
}

type Side = "YES" | "NO";

export default function OrderForm({ marketId, question }: OrderFormProps) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { walletExists, ready } = useUnlink();
  const { burners, createBurner, fund, send: burnerSend } = useBurner();

  const [side, setSide] = useState<Side>("YES");
  const [price, setPrice] = useState("50");
  const [amount, setAmount] = useState("10");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState("");
  const [usePrivacy, setUsePrivacy] = useState(true);

  const handleSubmit = async () => {
    if (!address || !walletClient) return;
    setIsSubmitting(true);

    try {
      const priceInBps = Math.round(parseFloat(price) * 100);
      const amountWei = parseEther(amount);

      if (usePrivacy && walletExists && ready) {
        // === Private order via burner ===
        let burnerIndex: number;
        if (burners.length > 0) {
          // Reuse the latest burner account
          burnerIndex = burners.length - 1;
          setStep("Using burner account...");
        } else {
          setStep("Creating burner account...");
          burnerIndex = 0;
          await createBurner(burnerIndex);
        }

        setStep("Funding burner from shielded pool...");
        await fund.execute({
          index: burnerIndex,
          params: { token: CONTRACTS.PRIVAUSD, amount: amountWei },
        });

        setStep("Approving PrivaUSD...");
        const approveData = encodeFunctionData({
          abi: PRIVAUSD_ABI,
          functionName: "approve",
          args: [CONTRACTS.PRIVATE_MARKET, amountWei],
        });
        await burnerSend.execute({
          index: burnerIndex,
          tx: { to: CONTRACTS.PRIVAUSD, data: approveData },
        });

        setStep("Placing private order...");
        const orderData = encodeFunctionData({
          abi: PRIVATEMARKET_ABI,
          functionName: "placeOrder",
          args: [BigInt(marketId), side === "YES" ? 0 : 1, BigInt(priceInBps), amountWei],
        });
        await burnerSend.execute({
          index: burnerIndex,
          tx: { to: CONTRACTS.PRIVATE_MARKET, data: orderData },
        });

        setStep("Order placed privately!");
      } else {
        // === Public order (fallback) ===
        setStep("Approving PrivaUSD...");
        await walletClient.writeContract({
          address: CONTRACTS.PRIVAUSD,
          abi: PRIVAUSD_ABI,
          functionName: "approve",
          args: [CONTRACTS.PRIVATE_MARKET, amountWei],
        });

        setStep("Placing order...");
        await walletClient.writeContract({
          address: CONTRACTS.PRIVATE_MARKET,
          abi: PRIVATEMARKET_ABI,
          functionName: "placeOrder",
          args: [BigInt(marketId), side === "YES" ? 0 : 1, BigInt(priceInBps), amountWei],
        });

        setStep("Order placed!");
      }
    } catch (e: any) {
      console.error("Order failed:", e);
      const msg = e.shortMessage || e.message || String(e);
      if (msg.includes("404") || msg.includes("SERVER_ERROR")) {
        setStep("Error: Unlink privacy service unavailable. Try a public order instead.");
      } else {
        setStep(`Error: ${msg}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Place Order</h3>

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSide("YES")}
          className={`rounded-lg py-2.5 text-sm font-semibold transition ${
            side === "YES"
              ? "bg-emerald-600 text-white"
              : "bg-white/5 text-white/40 hover:bg-white/10"
          }`}
        >
          YES
        </button>
        <button
          onClick={() => setSide("NO")}
          className={`rounded-lg py-2.5 text-sm font-semibold transition ${
            side === "NO"
              ? "bg-red-600 text-white"
              : "bg-white/5 text-white/40 hover:bg-white/10"
          }`}
        >
          NO
        </button>
      </div>

      {/* Price input */}
      <div>
        <label className="block text-xs text-white/40 mb-1">
          {side} price (% of payout)
        </label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="1"
            max="99"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="flex-1 accent-violet-500"
          />
          <span className="text-sm font-mono text-white w-12 text-right">{price}%</span>
        </div>
        <div className="flex justify-between text-xs text-white/20 mt-1">
          <span>1%</span>
          <span>50%</span>
          <span>99%</span>
        </div>
      </div>

      {/* Amount input */}
      <div>
        <label className="block text-xs text-white/40 mb-1">Amount (PUSD)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          min="0"
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white font-mono placeholder:text-white/30 focus:outline-none focus:border-violet-500"
        />
      </div>

      {/* Privacy toggle */}
      {walletExists && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Private order (via burner)</span>
          <button
            onClick={() => setUsePrivacy(!usePrivacy)}
            className={`relative h-5 w-9 rounded-full transition ${usePrivacy ? "bg-violet-600" : "bg-white/20"}`}
          >
            <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition ${usePrivacy ? "translate-x-4" : ""}`} />
          </button>
        </div>
      )}

      {/* Cost summary */}
      <div className="rounded-lg bg-white/5 p-3 text-xs">
        <div className="flex justify-between text-white/40">
          <span>Cost</span>
          <span className="font-mono text-white">{amount || "0"} PUSD</span>
        </div>
        <div className="flex justify-between text-white/40 mt-1">
          <span>Potential payout</span>
          <span className="font-mono text-white">
            {price && amount
              ? (parseFloat(amount) / (parseFloat(price) / 100)).toFixed(2)
              : "0"} PUSD
          </span>
        </div>
        <div className="flex justify-between text-white/30 mt-1">
          <span>Return</span>
          <span className="font-mono">
            {price ? `${(100 / parseFloat(price)).toFixed(1)}x` : "—"}
          </span>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || !address || !amount || parseFloat(amount) <= 0}
        className={`w-full rounded-lg py-3 text-sm font-semibold transition ${
          side === "YES"
            ? "bg-emerald-600 hover:bg-emerald-500 text-white"
            : "bg-red-600 hover:bg-red-500 text-white"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isSubmitting
          ? step
          : `${usePrivacy && walletExists ? "Private " : ""}Buy ${side} @ ${price}%`}
      </button>

      {!address && (
        <p className="text-xs text-center text-white/30">Connect wallet to trade</p>
      )}

      <p className="text-xs text-white/25 text-center">
        Orders persist across batches until matched. Both YES and NO orders are needed for price discovery.
      </p>
    </div>
  );
}
