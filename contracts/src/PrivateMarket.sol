// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OutcomeToken} from "./OutcomeToken.sol";
import {IERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/// @title PrivateMarket
/// @notice Prediction market with Frequent Batch Auctions (FBA) for MEV-resistant price discovery
/// @dev Designed to work with Unlink's privacy SDK via burner accounts
contract PrivateMarket {
    // ─── Enums ─────────────────────────────────────────────
    enum Side {
        YES,
        NO
    }
    enum Outcome {
        UNRESOLVED,
        YES,
        NO
    }

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
        uint256 price; // basis points 0-10000
        uint256 amount; // collateral in wei
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
    event BatchCleared(
        uint256 indexed marketId, uint256 indexed batchId, uint256 clearingPrice, uint256 yesVolume, uint256 noVolume
    );
    event MarketResolved(uint256 indexed marketId, Outcome outcome);
    event Redeemed(uint256 indexed marketId, address indexed trader, uint256 amount, uint256 payout);
    event OrderCancelled(
        uint256 indexed marketId, uint256 indexed batchId, uint256 orderIndex, address trader, uint256 amount
    );

    // ─── Errors ────────────────────────────────────────────
    error OnlyAdmin();
    error InvalidPrice();
    error ZeroAmount();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error BatchNotReady();
    error InvalidOutcome();
    error TransferFailed();
    error NotOrderOwner();
    error OrderAlreadyFilled();

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

    function createMarket(string calldata question, uint256 resolutionTime, uint256 batchInterval)
        external
        returns (uint256 marketId)
    {
        marketId = nextMarketId++;

        // Deploy outcome tokens
        OutcomeToken yesToken = new OutcomeToken(string.concat("YES-", question), "YES", address(this));
        OutcomeToken noToken = new OutcomeToken(string.concat("NO-", question), "NO", address(this));

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

    function placeOrder(uint256 marketId, Side side, uint256 price, uint256 amount) external {
        Market storage m = markets[marketId];
        if (m.resolved != Outcome.UNRESOLVED) revert MarketAlreadyResolved();
        if (price == 0 || price >= 10000) revert InvalidPrice();
        if (amount == 0) revert ZeroAmount();

        // Transfer collateral from trader
        bool success = IERC20(collateralToken).transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();

        uint256 batchId = _currentBatchId(marketId);

        _batchOrders[marketId][batchId].push(
            Order({trader: msg.sender, side: side, price: price, amount: amount, filled: false})
        );

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

    function _executeFBA(uint256 marketId, uint256 batchId, Order[] storage orders, Market storage m) internal {
        uint256 len = orders.length;

        uint256 yesCount;
        uint256 noCount;
        for (uint256 i; i < len; i++) {
            if (orders[i].side == Side.YES) yesCount++;
            else noCount++;
        }

        if (yesCount == 0 || noCount == 0) {
            _carryForward(marketId, batchId + 1, orders);
            batchResults[marketId][batchId] = BatchResult(5000, 0, 0, block.timestamp);
            emit BatchCleared(marketId, batchId, 5000, 0, 0);
            return;
        }

        uint256[] memory candidates = new uint256[](len * 2);
        uint256 candidateCount;
        for (uint256 i; i < len; i++) {
            uint256 candidate = orders[i].side == Side.YES ? orders[i].price : 10000 - orders[i].price;

            if (candidate == 0 || candidate >= 10000) continue;

            bool seen;
            for (uint256 j; j < candidateCount; j++) {
                if (candidates[j] == candidate) {
                    seen = true;
                    break;
                }
            }

            if (!seen) {
                candidates[candidateCount] = candidate;
                candidateCount++;
            }
        }

        if (candidateCount == 0) {
            _carryForward(marketId, batchId + 1, orders);
            batchResults[marketId][batchId] = BatchResult(5000, 0, 0, block.timestamp);
            emit BatchCleared(marketId, batchId, 5000, 0, 0);
            return;
        }

        uint256 clearingPrice = 5000;
        uint256 bestMatched;
        uint256 bestImbalance = type(uint256).max;
        uint256 bestDistance = type(uint256).max;

        for (uint256 c; c < candidateCount; c++) {
            uint256 candidatePrice = candidates[c];
            uint256 noThreshold = 10000 - candidatePrice;
            uint256 yesEligible;
            uint256 noEligible;

            for (uint256 i; i < len; i++) {
                Order storage o = orders[i];
                if (o.amount == 0) continue;

                if (o.side == Side.YES) {
                    if (o.price >= candidatePrice) yesEligible += o.amount;
                } else if (o.price >= noThreshold) {
                    noEligible += o.amount;
                }
            }

            uint256 matched = yesEligible < noEligible ? yesEligible : noEligible;
            uint256 imbalance = _absDiff(yesEligible, noEligible);
            uint256 distance = _absDiff(candidatePrice, 5000);

            if (
                matched > bestMatched || (matched == bestMatched && imbalance < bestImbalance)
                    || (matched == bestMatched && imbalance == bestImbalance && distance < bestDistance)
            ) {
                bestMatched = matched;
                bestImbalance = imbalance;
                bestDistance = distance;
                clearingPrice = candidatePrice;
            }
        }

        if (bestMatched == 0) {
            _carryForward(marketId, batchId + 1, orders);
            batchResults[marketId][batchId] = BatchResult(clearingPrice, 0, 0, block.timestamp);
            emit BatchCleared(marketId, batchId, clearingPrice, 0, 0);
            return;
        }

        uint256 noPrice = 10000 - clearingPrice;
        uint256 totalEligibleYes;
        uint256 totalEligibleNo;

        for (uint256 i; i < len; i++) {
            Order storage o = orders[i];
            if (o.amount == 0) continue;

            if (o.side == Side.YES) {
                if (o.price >= clearingPrice) totalEligibleYes += o.amount;
            } else if (o.price >= noPrice) {
                totalEligibleNo += o.amount;
            }
        }

        uint256[] memory yesFillAmounts = new uint256[](len);
        uint256[] memory noFillAmounts = new uint256[](len);

        if (totalEligibleYes > 0) {
            uint256 allocatedYes;
            uint256[] memory yesEligibleIndexes = new uint256[](len);
            uint256 yesEligibleIndexCount;

            for (uint256 i; i < len; i++) {
                Order storage o = orders[i];
                if (o.side != Side.YES || o.amount == 0 || o.price < clearingPrice) continue;

                yesEligibleIndexes[yesEligibleIndexCount] = i;
                yesEligibleIndexCount++;

                uint256 fillAmount = (o.amount * bestMatched) / totalEligibleYes;
                yesFillAmounts[i] = fillAmount;
                allocatedYes += fillAmount;
            }

            uint256 yesRemainder = bestMatched - allocatedYes;
            for (uint256 i; i < yesEligibleIndexCount && yesRemainder > 0; i++) {
                uint256 index = yesEligibleIndexes[i];
                uint256 available = orders[index].amount - yesFillAmounts[index];
                if (available == 0) continue;

                uint256 delta = available < yesRemainder ? available : yesRemainder;
                yesFillAmounts[index] += delta;
                yesRemainder -= delta;
            }
        }

        if (totalEligibleNo > 0) {
            uint256 allocatedNo;
            uint256[] memory noEligibleIndexes = new uint256[](len);
            uint256 noEligibleIndexCount;

            for (uint256 i; i < len; i++) {
                Order storage o = orders[i];
                if (o.side != Side.NO || o.amount == 0 || o.price < noPrice) continue;

                noEligibleIndexes[noEligibleIndexCount] = i;
                noEligibleIndexCount++;

                uint256 fillAmount = (o.amount * bestMatched) / totalEligibleNo;
                noFillAmounts[i] = fillAmount;
                allocatedNo += fillAmount;
            }

            uint256 noRemainder = bestMatched - allocatedNo;
            for (uint256 i; i < noEligibleIndexCount && noRemainder > 0; i++) {
                uint256 index = noEligibleIndexes[i];
                uint256 available = orders[index].amount - noFillAmounts[index];
                if (available == 0) continue;

                uint256 delta = available < noRemainder ? available : noRemainder;
                noFillAmounts[index] += delta;
                noRemainder -= delta;
            }
        }

        uint256 yesVolume;
        uint256 noVolume;

        for (uint256 i; i < len; i++) {
            Order storage o = orders[i];
            if (o.amount == 0 || o.filled) continue;

            uint256 fillAmount = o.side == Side.YES ? yesFillAmounts[i] : noFillAmounts[i];
            if (fillAmount > o.amount) fillAmount = o.amount;

            if (fillAmount > 0) {
                if (o.side == Side.YES) {
                    uint256 yesTokenAmount = (fillAmount * 10000) / clearingPrice;
                    OutcomeToken(m.yesToken).mint(o.trader, yesTokenAmount);
                    yesVolume += fillAmount;
                } else {
                    uint256 noTokenAmount = (fillAmount * 10000) / noPrice;
                    OutcomeToken(m.noToken).mint(o.trader, noTokenAmount);
                    noVolume += fillAmount;
                }

                m.collateralPool += fillAmount;

                uint256 remainingAmount = o.amount - fillAmount;
                if (remainingAmount > 0) {
                    _batchOrders[marketId][batchId
                            + 1].push(
                        Order({trader: o.trader, side: o.side, price: o.price, amount: remainingAmount, filled: false})
                    );
                }

                o.amount = fillAmount;
                o.filled = true;
            } else {
                _batchOrders[marketId][batchId
                        + 1].push(
                    Order({trader: o.trader, side: o.side, price: o.price, amount: o.amount, filled: false})
                );
                o.filled = true;
            }
        }

        batchResults[marketId][batchId] = BatchResult(clearingPrice, yesVolume, noVolume, block.timestamp);
        emit BatchCleared(marketId, batchId, clearingPrice, yesVolume, noVolume);
    }

    function _carryForward(uint256 marketId, uint256 nextBatchId, Order[] storage orders) internal {
        for (uint256 i; i < orders.length; i++) {
            Order storage o = orders[i];
            if (o.filled || o.amount == 0) continue;

            _batchOrders[marketId][nextBatchId].push(
                Order({trader: o.trader, side: o.side, price: o.price, amount: o.amount, filled: false})
            );
            o.filled = true;
        }
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    // ─── Order Cancellation ──────────────────────────────────

    /// @notice Cancel a pending (unfilled) order and reclaim collateral
    /// @param marketId The market containing the order
    /// @param batchId The batch containing the order
    /// @param orderIndex The index of the order within the batch
    function cancelOrder(uint256 marketId, uint256 batchId, uint256 orderIndex) external {
        Order storage o = _batchOrders[marketId][batchId][orderIndex];
        if (o.trader != msg.sender) revert NotOrderOwner();
        if (o.filled) revert OrderAlreadyFilled();
        if (o.amount == 0) revert ZeroAmount();

        uint256 refundAmount = o.amount;
        o.amount = 0;
        o.filled = true;

        IERC20(collateralToken).transfer(msg.sender, refundAmount);
        emit OrderCancelled(marketId, batchId, orderIndex, msg.sender, refundAmount);
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

    function getMarket(uint256 marketId)
        external
        view
        returns (
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
        )
    {
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
