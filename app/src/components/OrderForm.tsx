"use client";

import { useRef, useState } from "react";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { useUnlink, useBurner, useDeposit } from "@unlink-xyz/react";
import { CONTRACTS, isConfiguredAddress, monadTestnet } from "@/lib/config";
import { PRIVATEMARKET_ABI, WMON_ABI } from "@/lib/contracts";
import { parseEther, encodeFunctionData, createWalletClient, http, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface OrderFormProps {
  marketId: number;
  marketYesPriceBps?: number;
}

type Side = "YES" | "NO";
const MIN_BURNER_GAS_BALANCE = parseEther("0.01");
const BURNER_TX_GAS_LIMIT = 300000n;
const BURNER_GAS_BUFFER = parseEther("0.002");

export default function OrderForm({ marketId, marketYesPriceBps }: OrderFormProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { unlink, walletExists, ready, getTxStatus, refresh } = useUnlink();
  const { burners, createBurner, fund } = useBurner();
  const { deposit: shieldDeposit } = useDeposit();

  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("10");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState("");
  const [usePrivacy, setUsePrivacy] = useState(true);
  const submitLockRef = useRef(false);
  const networkMismatch = chainId !== monadTestnet.id;
  const contractsReady =
    isConfiguredAddress(CONTRACTS.PRIVATE_MARKET) &&
    isConfiguredAddress(CONTRACTS.WMON);
  const effectiveYesPriceBps = marketYesPriceBps !== undefined
    ? Math.min(9900, Math.max(100, Math.round(marketYesPriceBps)))
    : 5000;
  const usingFallbackPrice = marketYesPriceBps === undefined;
  const marketSidePriceBps = side === "YES" ? effectiveYesPriceBps : 10000 - effectiveYesPriceBps;
  const marketSidePricePct = marketSidePriceBps / 100;
  const parsedAmount = Number.parseFloat(amount);
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const marketPayout = hasValidAmount && marketSidePricePct > 0
    ? (parsedAmount / (marketSidePricePct / 100)).toFixed(2)
    : "—";
  const marketReturn = marketSidePricePct > 0 ? `${(100 / marketSidePricePct).toFixed(1)}x` : "—";

  const waitForHash = async (hash?: `0x${string}`) => {
    if (!hash || !publicClient) return;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction reverted: ${hash}`);
    }
  };

  const waitForRelay = async (relayId: string, timeoutMs = 120000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const status = await getTxStatus(relayId);
        if (status.state === "succeeded") return;
        if (status.state === "failed" || status.state === "reverted" || status.state === "dead") {
          throw new Error(status.error ?? `Relay ${relayId} failed with state ${status.state}`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (!msg.includes("404")) {
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
  };

  const sendBurnerTx = async (index: number, to: `0x${string}`, data: `0x${string}`) => {
    if (!unlink) throw new Error("Privacy wallet not initialized.");
    const burnerPrivateKey = await unlink.burner.exportKey(index);
    const burnerClient = createWalletClient({
      account: privateKeyToAccount(burnerPrivateKey as `0x${string}`),
      chain: monadTestnet,
      transport: http(monadTestnet.rpcUrls.default.http[0]),
    });
    const fees = await publicClient?.estimateFeesPerGas().catch(() => null);
    const txParams = fees?.maxFeePerGas
      ? {
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        }
      : fees?.gasPrice
        ? { gasPrice: fees.gasPrice }
        : {};
    const hash = await burnerClient.sendTransaction({
      to,
      data,
      gas: BURNER_TX_GAS_LIMIT,
      ...txParams,
    });
    await waitForHash(hash);
    return hash;
  };

  const ensureShieldedWmon = async (requiredAmount: bigint) => {
    if (!unlink || !address || !walletClient || !publicClient) {
      throw new Error("Privacy wallet not initialized.");
    }

    let shieldedBalance = await unlink.getBalance(CONTRACTS.WMON);
    if (shieldedBalance >= requiredAmount) return;

    const shortfall = requiredAmount - shieldedBalance;
    const walletBalance = await publicClient.getBalance({ address });
    if (walletBalance < shortfall) {
      throw new Error("Insufficient MON to auto-shield required WMON for this private order.");
    }

    setStep("Shielded WMON low. Auto-shielding MON...");
    const wrapHash = await walletClient.writeContract({
      address: CONTRACTS.WMON,
      abi: WMON_ABI,
      functionName: "deposit",
      args: [],
      value: shortfall,
    });
    await waitForHash(wrapHash);

    const depositResult = await shieldDeposit([
      { token: CONTRACTS.WMON, amount: shortfall, depositor: address },
    ]);

    const approveHash = await walletClient.writeContract({
      address: CONTRACTS.WMON,
      abi: WMON_ABI,
      functionName: "approve",
      args: [depositResult.to as `0x${string}`, shortfall],
    });
    await waitForHash(approveHash);

    const shieldHash = await walletClient.sendTransaction({
      to: depositResult.to as `0x${string}`,
      data: depositResult.calldata as `0x${string}`,
      value: depositResult.value,
    });
    await waitForHash(shieldHash);

    setStep("Waiting for shielded top-up confirmation...");
    await waitForRelay(depositResult.relayId);
    await refresh();

    shieldedBalance = await unlink.getBalance(CONTRACTS.WMON);
    if (shieldedBalance < requiredAmount) {
      throw new Error("Insufficient shielded WMON balance for this private order.");
    }
  };

  const ensureBurnerGas = async (burnerAddress: `0x${string}`, txCount: number) => {
    if (!address || !walletClient || !publicClient) {
      throw new Error("Wallet not initialized.");
    }

    const fees = await publicClient.estimateFeesPerGas().catch(() => null);
    const feePerGas = fees?.maxFeePerGas ?? fees?.gasPrice;
    const txCountBigInt = BigInt(Math.max(txCount, 1));
    const requiredBalance =
      feePerGas && feePerGas > 0n
        ? ((feePerGas * BURNER_TX_GAS_LIMIT * txCountBigInt * 12n) / 10n) + BURNER_GAS_BUFFER
        : MIN_BURNER_GAS_BALANCE * txCountBigInt;

    const burnerBalance = await publicClient.getBalance({ address: burnerAddress });
    if (burnerBalance >= requiredBalance) return;

    const topUpAmount = requiredBalance - burnerBalance;
    const walletBalance = await publicClient.getBalance({ address });
    if (walletBalance < topUpAmount) {
      throw new Error("Insufficient MON to top up burner gas for private order.");
    }

    setStep("Topping up burner MON for gas...");
    const topUpHash = await walletClient.sendTransaction({
      to: burnerAddress,
      value: topUpAmount,
    });
    await waitForHash(topUpHash);
  };

  const getBurnerAllowance = async (burnerAddress: `0x${string}`) => {
    if (!publicClient) throw new Error("Public client not initialized.");
    return publicClient.readContract({
      address: CONTRACTS.WMON,
      abi: WMON_ABI,
      functionName: "allowance",
      args: [burnerAddress, CONTRACTS.PRIVATE_MARKET],
    });
  };

  const ensureBurnerWmon = async (burnerAddress: `0x${string}`, requiredAmount: bigint) => {
    if (!address || !walletClient || !publicClient) {
      throw new Error("Wallet not initialized.");
    }

    const burnerBalance = await publicClient.readContract({
      address: CONTRACTS.WMON,
      abi: WMON_ABI,
      functionName: "balanceOf",
      args: [burnerAddress],
    });
    if (burnerBalance >= requiredAmount) return;

    const deficit = requiredAmount - burnerBalance;
    const walletWmon = await publicClient.readContract({
      address: CONTRACTS.WMON,
      abi: WMON_ABI,
      functionName: "balanceOf",
      args: [address],
    });

    if (walletWmon < deficit) {
      const wrapNeeded = deficit - walletWmon;
      const walletMon = await publicClient.getBalance({ address });
      if (walletMon < wrapNeeded) {
        throw new Error("Insufficient MON to top up burner WMON for private order.");
      }

      setStep("Wrapping MON to WMON for burner top-up...");
      const wrapHash = await walletClient.writeContract({
        address: CONTRACTS.WMON,
        abi: WMON_ABI,
        functionName: "deposit",
        args: [],
        value: wrapNeeded,
      });
      await waitForHash(wrapHash);
    }

    setStep("Topping up burner WMON...");
    const transferHash = await walletClient.writeContract({
      address: CONTRACTS.WMON,
      abi: WMON_ABI,
      functionName: "transfer",
      args: [burnerAddress, deficit],
    });
    await waitForHash(transferHash);
  };

  const ensureBurnerAllowance = async (
    burnerIndex: number,
    burnerAddress: `0x${string}`,
    requiredAmount: bigint
  ) => {
    if (!publicClient) {
      throw new Error("Public client not initialized.");
    }

    let allowance = await publicClient.readContract({
      address: CONTRACTS.WMON,
      abi: WMON_ABI,
      functionName: "allowance",
      args: [burnerAddress, CONTRACTS.PRIVATE_MARKET],
    });

    if (allowance >= requiredAmount) return;

    setStep("Approving WMON...");
    const approveData = encodeFunctionData({
      abi: WMON_ABI,
      functionName: "approve",
      args: [CONTRACTS.PRIVATE_MARKET, maxUint256],
    });
    await sendBurnerTx(burnerIndex, CONTRACTS.WMON, approveData);

    allowance = await publicClient.readContract({
      address: CONTRACTS.WMON,
      abi: WMON_ABI,
      functionName: "allowance",
      args: [burnerAddress, CONTRACTS.PRIVATE_MARKET],
    });
    if (allowance < requiredAmount) {
      throw new Error("Failed to set burner WMON allowance for private order.");
    }
  };

  const handleSubmit = async () => {
    if (!address || !walletClient || submitLockRef.current) return;
    if (networkMismatch) {
      setStep("Switch to Monad Testnet to place orders.");
      return;
    }
    if (!contractsReady) {
      setStep("Missing contract config. Set NEXT_PUBLIC_PRIVATE_MARKET_ADDRESS and NEXT_PUBLIC_WMON_ADDRESS.");
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);

    try {
      const priceInBps = marketSidePriceBps;
      const amountWei = parseEther(amount);

      if (usePrivacy && walletExists && ready) {
        // === Private order via burner ===
        let burnerIndex: number;
        let burnerAddress: `0x${string}`;
        if (burners.length > 0) {
          // Reuse the latest burner account
          burnerIndex = burners.length - 1;
          burnerAddress = burners[burnerIndex].address as `0x${string}`;
          setStep("Using burner account...");
        } else {
          setStep("Creating burner account...");
          burnerIndex = 0;
          const burner = await createBurner(burnerIndex);
          burnerAddress = burner.address as `0x${string}`;
        }

        setStep("Checking shielded WMON balance...");
        try {
          await ensureShieldedWmon(amountWei);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (
            msg.includes("404") ||
            msg.includes("timeout") ||
            msg.includes("pending") ||
            msg.includes("server_error")
          ) {
            setStep("Shielded relay delayed. Using direct burner funding...");
          } else {
            throw error;
          }
        }
        try {
          setStep("Funding burner from shielded pool...");
          const fundResult = await fund.execute({
            index: burnerIndex,
            params: { token: CONTRACTS.WMON, amount: amountWei },
          });
          setStep("Waiting for shielded transfer confirmation...");
          const confirmed = await waitForRelay(fundResult.relayId);
          if (!confirmed) {
            setStep("Shielded transfer pending. Using direct burner top-up...");
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (
            msg.includes("404") ||
            msg.includes("timeout") ||
            msg.includes("server_error")
          ) {
            setStep("Shielded transfer unavailable. Using direct burner top-up...");
          } else {
            throw error;
          }
        }

        await ensureBurnerWmon(burnerAddress, amountWei);
        const currentAllowance = await getBurnerAllowance(burnerAddress);
        await ensureBurnerGas(burnerAddress, currentAllowance >= amountWei ? 1 : 2);
        await ensureBurnerAllowance(burnerIndex, burnerAddress, amountWei);

        setStep("Placing private order...");
        const orderData = encodeFunctionData({
          abi: PRIVATEMARKET_ABI,
          functionName: "placeOrder",
          args: [BigInt(marketId), side === "YES" ? 0 : 1, BigInt(priceInBps), amountWei],
        });
        await sendBurnerTx(burnerIndex, CONTRACTS.PRIVATE_MARKET, orderData);

        setStep("Private order submitted!");
      } else {
        // === Public order (fallback) ===
        setStep("Wrapping MON to WMON...");
        const wrapHash = await walletClient.writeContract({
          address: CONTRACTS.WMON,
          abi: WMON_ABI,
          functionName: "deposit",
          args: [],
          value: amountWei,
        });
        await waitForHash(wrapHash);

        setStep("Approving WMON...");
        const approveHash = await walletClient.writeContract({
          address: CONTRACTS.WMON,
          abi: WMON_ABI,
          functionName: "approve",
          args: [CONTRACTS.PRIVATE_MARKET, amountWei],
        });
        await waitForHash(approveHash);

        setStep("Placing order...");
        const orderHash = await walletClient.writeContract({
          address: CONTRACTS.PRIVATE_MARKET,
          abi: PRIVATEMARKET_ABI,
          functionName: "placeOrder",
          args: [BigInt(marketId), side === "YES" ? 0 : 1, BigInt(priceInBps), amountWei],
        });
        void orderHash;

        setStep("Order submitted!");
      }
    } catch (error: unknown) {
      console.error("Order failed:", error);
      const msg =
        error &&
        typeof error === "object" &&
        "shortMessage" in error &&
        typeof (error as { shortMessage?: unknown }).shortMessage === "string"
          ? (error as { shortMessage: string }).shortMessage
          : error instanceof Error
            ? error.message
            : String(error);
      const normalized = msg.toLowerCase();

      if (
        (normalized.includes("timeout") && normalized.includes("confirmation")) ||
        normalized.includes("waitforconfirmation")
      ) {
        setUsePrivacy(false);
        setStep("Private relay confirmation timed out. Check shielded WMON balance, then retry.");
      } else if (
        normalized.includes("404") ||
        normalized.includes("server_error") ||
        normalized.includes("http timeout")
      ) {
        setUsePrivacy(false);
        setStep("Privacy service unavailable. Switched to public mode.");
      } else if (normalized.includes("nonce too low")) {
        setStep("Error: Nonce too low. Wait for pending tx confirmation, then retry.");
      } else if (
        normalized.includes("insufficient funds") ||
        normalized.includes("gas * price + value")
      ) {
        setStep("Insufficient MON for shielding or burner gas. Add MON and retry private buy.");
      } else {
        setStep(`Error: ${msg}`);
      }
    } finally {
      submitLockRef.current = false;
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

      {/* Amount input */}
      <div>
        <label className="block text-xs text-white/40 mb-1">Amount (MON)</label>
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
          <span className="font-mono text-white">{amount || "0"} MON</span>
        </div>
        <div className="flex justify-between text-white/40 mt-1">
          <span>{side} market price</span>
          <span className="font-mono text-white">{marketSidePricePct.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between text-white/40 mt-1">
          <span>Potential payout</span>
          <span className="font-mono text-white">
            {marketPayout === "—" ? "—" : `${marketPayout} MON`}
          </span>
        </div>
        <div className="flex justify-between text-white/30 mt-1">
          <span>Return</span>
          <span className="font-mono">
            {marketReturn}
          </span>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={
          isSubmitting ||
          !address ||
          !amount ||
          parseFloat(amount) <= 0 ||
          networkMismatch ||
          !contractsReady
        }
        className={`w-full rounded-lg py-3 text-sm font-semibold transition ${
          side === "YES"
            ? "bg-emerald-600 hover:bg-emerald-500 text-white"
            : "bg-red-600 hover:bg-red-500 text-white"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isSubmitting
          ? step
          : `${usePrivacy && walletExists ? "Private " : ""}Buy ${side}`}
      </button>

      {!address && (
        <p className="text-xs text-center text-white/30">Connect wallet to trade</p>
      )}
      {address && networkMismatch && (
        <p className="text-xs text-center text-amber-400">Switch to Monad Testnet to trade.</p>
      )}
      {address && !contractsReady && (
        <p className="text-xs text-center text-amber-400">
          Missing contract config. Set market + WMON addresses in env.
        </p>
      )}

      <p className="text-xs text-white/25 text-center">
        {usingFallbackPrice
          ? "Using 50/50 startup price until the first matched batch is cleared."
          : "Order uses current market-implied price. Orders persist across batches until matched."}
      </p>
    </div>
  );
}
