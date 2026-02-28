// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OutcomeToken} from "./OutcomeToken.sol";
import {IERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/// @title PrivateMarket
/// @notice Prediction market with Frequent Batch Auctions (FBA) for MEV-resistant price discovery
/// @dev Designed to work with Unlink's privacy SDK via burner accounts
contract PrivateMarket {
    // ─── Enums ─────────────────────────────────────────────
    enum Side { YES, NO }
    enum Outcome { UNRESOLVED, YES, NO }

    // ─── Structs ───────────────────────────────────────────
    struct Market {
        string question;
        uint256 resolutionTime;
        address yesToken;
        address noToken;
        address creator;
        Outcome resolved;
        uint256 currentBatchId;
        uint256 batchInterval;
        uint256 lastClearTime;
        uint256 collateralPool;
        address collateralToken;
    }

    struct Order {
        address trader;
        Side side;
        uint256 price;    // basis points 0-10000
        uint256 amount;   // collateral in wei
        bool filled;
    }

    struct BatchResult {
        uint256 clearingPrice;
        uint256 yesVolume;
        uint256 noVolume;
        uint256 timestamp;
    }

    // ─── State ─────────────────────────────────────────────
    address public admin;
    uint256 public nextMarketId;
    address public immutable collateralToken;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(uint256 => Order[])) internal _batchOrders;
    mapping(uint256 => mapping(uint256 => BatchResult)) public batchResults;

    // ─── Events ────────────────────────────────────────────
    event MarketCreated(uint256 indexed marketId, string question, address yesToken, address noToken);
    event OrderPlaced(uint256 indexed marketId, uint256 indexed batchId, Side side, uint256 price, uint256 amount);
    event BatchCleared(uint256 indexed marketId, uint256 indexed batchId, uint256 clearingPrice, uint256 yesVolume, uint256 noVolume);
    event MarketResolved(uint256 indexed marketId, Outcome outcome);
    event Redeemed(uint256 indexed marketId, address indexed trader, uint256 amount, uint256 payout);

    // ─── Errors ────────────────────────────────────────────
    error OnlyAdmin();
    error InvalidPrice();
    error ZeroAmount();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error BatchNotReady();
    error InvalidOutcome();
    error TransferFailed();

    // ─── Modifiers ─────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    // ─── Constructor ───────────────────────────────────────
    constructor(address _collateralToken) {
        admin = msg.sender;
        collateralToken = _collateralToken;
    }

    // ─── Market Management ─────────────────────────────────

    function createMarket(
        string calldata question,
        uint256 resolutionTime,
        uint256 batchInterval
    ) external returns (uint256 marketId) {
        marketId = nextMarketId++;

        // Deploy outcome tokens
        OutcomeToken yesToken = new OutcomeToken(
            string.concat("YES-", question),
            "YES",
            address(this)
        );
        OutcomeToken noToken = new OutcomeToken(
            string.concat("NO-", question),
            "NO",
            address(this)
        );

        markets[marketId] = Market({
            question: question,
            resolutionTime: resolutionTime,
            yesToken: address(yesToken),
            noToken: address(noToken),
            creator: msg.sender,
            resolved: Outcome.UNRESOLVED,
            currentBatchId: 0,
            batchInterval: batchInterval == 0 ? 5 : batchInterval,
            lastClearTime: block.timestamp,
            collateralPool: 0,
            collateralToken: collateralToken
        });

        emit MarketCreated(marketId, question, address(yesToken), address(noToken));
    }

    // ─── Order Placement ───────────────────────────────────

    function placeOrder(
        uint256 marketId,
        Side side,
        uint256 price,
        uint256 amount
    ) external {
        Market storage m = markets[marketId];
        if (m.resolved != Outcome.UNRESOLVED) revert MarketAlreadyResolved();
        if (price == 0 || price >= 10000) revert InvalidPrice();
        if (amount == 0) revert ZeroAmount();

        // Transfer collateral from trader
        bool success = IERC20(collateralToken).transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();

        uint256 batchId = _currentBatchId(marketId);

        _batchOrders[marketId][batchId].push(Order({
            trader: msg.sender,
            side: side,
            price: price,
            amount: amount,
            filled: false
        }));

        emit OrderPlaced(marketId, batchId, side, price, amount);
    }

    // ─── Batch Clearing (FBA) ──────────────────────────────

    function clearBatch(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (m.resolved != Outcome.UNRESOLVED) revert MarketAlreadyResolved();

        uint256 batchId = m.currentBatchId;
        if (block.timestamp < m.lastClearTime + m.batchInterval) revert BatchNotReady();

        Order[] storage orders = _batchOrders[marketId][batchId];

        if (orders.length > 0) {
            _executeFBA(marketId, batchId, orders, m);
        }

        // Advance to next batch
        m.currentBatchId = batchId + 1;
        m.lastClearTime = block.timestamp;
    }

    function _executeFBA(
        uint256 marketId,
        uint256 batchId,
        Order[] storage orders,
        Market storage m
    ) internal {
        // Separate YES and NO orders
        uint256 len = orders.length;

        // Count orders per side
        uint256 yesCount;
        uint256 noCount;
        for (uint256 i; i < len; i++) {
            if (orders[i].side == Side.YES) yesCount++;
            else noCount++;
        }

        if (yesCount == 0 || noCount == 0) {
            // No crossing possible — refund all orders
            _refundAll(orders);
            batchResults[marketId][batchId] = BatchResult(5000, 0, 0, block.timestamp);
            emit BatchCleared(marketId, batchId, 5000, 0, 0);
            return;
        }

        // Build sorted price arrays (simplified: find volume-weighted clearing price)
        uint256 totalYesWeighted;
        uint256 totalYesAmount;
        uint256 totalNoWeighted;
        uint256 totalNoAmount;

        for (uint256 i; i < len; i++) {
            if (orders[i].side == Side.YES) {
                totalYesWeighted += orders[i].price * orders[i].amount;
                totalYesAmount += orders[i].amount;
            } else {
                totalNoWeighted += orders[i].price * orders[i].amount;
                totalNoAmount += orders[i].amount;
            }
        }

        // Clearing price = volume-weighted average of YES bids
        // (simplified FBA for hackathon — production would use full order book crossing)
        uint256 clearingPrice = totalYesWeighted / totalYesAmount;

        // Ensure price is valid (between 100 and 9900 basis points)
        if (clearingPrice < 100) clearingPrice = 100;
        if (clearingPrice > 9900) clearingPrice = 9900;

        uint256 yesVolume;
        uint256 noVolume;

        // Fill orders
        for (uint256 i; i < len; i++) {
            Order storage o = orders[i];

            if (o.side == Side.YES && o.price >= clearingPrice) {
                // Fill YES order: trader pays (clearingPrice/10000) * amount for YES tokens
                uint256 tokenAmount = (o.amount * 10000) / clearingPrice;
                OutcomeToken(m.yesToken).mint(o.trader, tokenAmount);
                o.filled = true;
                yesVolume += o.amount;
                m.collateralPool += o.amount;
            } else if (o.side == Side.NO && o.price >= (10000 - clearingPrice)) {
                // Fill NO order: trader pays ((10000-clearingPrice)/10000) * amount for NO tokens
                uint256 noPrice = 10000 - clearingPrice;
                uint256 tokenAmount = (o.amount * 10000) / noPrice;
                OutcomeToken(m.noToken).mint(o.trader, tokenAmount);
                o.filled = true;
                noVolume += o.amount;
                m.collateralPool += o.amount;
            } else {
                // Refund unfilled order
                IERC20(collateralToken).transfer(o.trader, o.amount);
            }
        }

        batchResults[marketId][batchId] = BatchResult(clearingPrice, yesVolume, noVolume, block.timestamp);
        emit BatchCleared(marketId, batchId, clearingPrice, yesVolume, noVolume);
    }

    function _refundAll(Order[] storage orders) internal {
        for (uint256 i; i < orders.length; i++) {
            IERC20(collateralToken).transfer(orders[i].trader, orders[i].amount);
        }
    }

    // ─── Resolution & Redemption ───────────────────────────

    function resolve(uint256 marketId, Outcome outcome) external onlyAdmin {
        if (outcome == Outcome.UNRESOLVED) revert InvalidOutcome();
        Market storage m = markets[marketId];
        if (m.resolved != Outcome.UNRESOLVED) revert MarketAlreadyResolved();
        m.resolved = outcome;
        emit MarketResolved(marketId, outcome);
    }

    function redeem(uint256 marketId, uint256 amount) external {
        Market storage m = markets[marketId];
        if (m.resolved == Outcome.UNRESOLVED) revert MarketNotResolved();

        address winningToken = m.resolved == Outcome.YES ? m.yesToken : m.noToken;
        OutcomeToken(winningToken).burn(msg.sender, amount);

        // Each winning token is worth 1 unit of collateral
        uint256 payout = amount;
        if (payout > m.collateralPool) payout = m.collateralPool;
        m.collateralPool -= payout;

        IERC20(collateralToken).transfer(msg.sender, payout);
        emit Redeemed(marketId, msg.sender, amount, payout);
    }

    // ─── View Functions ────────────────────────────────────

    function getMarket(uint256 marketId) external view returns (
        string memory question,
        uint256 resolutionTime,
        address yesToken,
        address noToken,
        address creator,
        Outcome resolved,
        uint256 currentBatchId,
        uint256 batchInterval,
        uint256 lastClearTime,
        uint256 collateralPool
    ) {
        Market storage m = markets[marketId];
        return (
            m.question,
            m.resolutionTime,
            m.yesToken,
            m.noToken,
            m.creator,
            m.resolved,
            m.currentBatchId,
            m.batchInterval,
            m.lastClearTime,
            m.collateralPool
        );
    }

    function getBatchOrders(uint256 marketId, uint256 batchId) external view returns (Order[] memory) {
        return _batchOrders[marketId][batchId];
    }

    function getBatchResult(uint256 marketId, uint256 batchId) external view returns (BatchResult memory) {
        return batchResults[marketId][batchId];
    }

    function _currentBatchId(uint256 marketId) internal view returns (uint256) {
        return markets[marketId].currentBatchId;
    }

    function getCurrentBatchId(uint256 marketId) external view returns (uint256) {
        return _currentBatchId(marketId);
    }
}
