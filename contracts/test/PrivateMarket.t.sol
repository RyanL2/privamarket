// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrivateMarket} from "../src/PrivateMarket.sol";
import {MockWMON} from "../src/mocks/MockWMON.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";

contract PrivateMarketTest is Test {
    PrivateMarket public market;
    MockWMON public wmon;

    address admin = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");

    function setUp() public {
        wmon = new MockWMON();
        market = new PrivateMarket(address(wmon));

        // Fund test accounts with WMON
        vm.deal(alice, 10_000 ether);
        vm.prank(alice);
        wmon.deposit{value: 10_000 ether}();

        vm.deal(bob, 10_000 ether);
        vm.prank(bob);
        wmon.deposit{value: 10_000 ether}();

        vm.deal(charlie, 10_000 ether);
        vm.prank(charlie);
        wmon.deposit{value: 10_000 ether}();
    }

    // ─── Market Creation ───────────────────────────────────

    function test_createMarket() public {
        uint256 marketId = market.createMarket("Test question?", block.timestamp + 1 days, 5);
        assertEq(marketId, 0);

        (
            string memory question,
            uint256 resolutionTime,
            address yesToken,
            address noToken,
            address creator,
            PrivateMarket.Outcome resolved,
            uint256 currentBatchId,
            uint256 batchInterval,,
        ) = market.getMarket(0);

        assertEq(question, "Test question?");
        assertEq(resolutionTime, block.timestamp + 1 days);
        assertTrue(yesToken != address(0));
        assertTrue(noToken != address(0));
        assertEq(creator, address(this));
        assertEq(uint8(resolved), uint8(PrivateMarket.Outcome.UNRESOLVED));
        assertEq(currentBatchId, 0);
        assertEq(batchInterval, 5);
    }

    function test_createMultipleMarkets() public {
        market.createMarket("Q1?", block.timestamp + 1 days, 5);
        market.createMarket("Q2?", block.timestamp + 2 days, 10);
        assertEq(market.nextMarketId(), 2);
    }

    // ─── Order Placement ───────────────────────────────────

    function test_placeOrder() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.startPrank(alice);
        wmon.approve(address(market), 100 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 100 ether);
        vm.stopPrank();

        PrivateMarket.Order[] memory orders = market.getBatchOrders(0, 0);
        assertEq(orders.length, 1);
        assertEq(orders[0].trader, alice);
        assertEq(uint8(orders[0].side), uint8(PrivateMarket.Side.YES));
        assertEq(orders[0].price, 6000);
        assertEq(orders[0].amount, 100 ether);
        assertFalse(orders[0].filled);
    }

    function test_placeOrder_revertsOnInvalidPrice() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.startPrank(alice);
        wmon.approve(address(market), 100 ether);
        vm.expectRevert(PrivateMarket.InvalidPrice.selector);
        market.placeOrder(0, PrivateMarket.Side.YES, 0, 100 ether);
        vm.stopPrank();
    }

    function test_placeOrder_revertsOnZeroAmount() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.startPrank(alice);
        wmon.approve(address(market), 100 ether);
        vm.expectRevert(PrivateMarket.ZeroAmount.selector);
        market.placeOrder(0, PrivateMarket.Side.YES, 5000, 0);
        vm.stopPrank();
    }

    // ─── Batch Clearing ────────────────────────────────────

    function test_clearBatch_withMatchingOrders() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        // Alice bids YES at 60%
        vm.startPrank(alice);
        wmon.approve(address(market), 1000 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 1000 ether);
        vm.stopPrank();

        // Bob bids NO at 50% (which means he thinks YES <= 50%)
        vm.startPrank(bob);
        wmon.approve(address(market), 500 ether);
        market.placeOrder(0, PrivateMarket.Side.NO, 5000, 500 ether);
        vm.stopPrank();

        // Advance time past batch interval
        vm.warp(block.timestamp + 6);

        // Clear batch
        market.clearBatch(0);

        // Check batch result
        PrivateMarket.BatchResult memory result = market.getBatchResult(0, 0);
        assertTrue(result.clearingPrice > 0);
        assertTrue(result.timestamp > 0);

        // Check tokens were minted
        (,, address yesToken, address noToken,,,,,,) = market.getMarket(0);
        assertTrue(OutcomeToken(yesToken).totalSupply() > 0 || OutcomeToken(noToken).totalSupply() > 0);
    }

    function test_clearBatch_carriesForwardWhenNoCounterparty() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        // Only YES orders, no NO orders
        vm.startPrank(alice);
        wmon.approve(address(market), 100 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 100 ether);
        vm.stopPrank();

        uint256 balanceBefore = wmon.balanceOf(alice);

        vm.warp(block.timestamp + 6);
        market.clearBatch(0);

        // Alice should NOT be refunded — order carries to next batch
        uint256 balanceAfter = wmon.balanceOf(alice);
        assertEq(balanceAfter, balanceBefore);

        // Order should exist in batch 1 (next batch)
        PrivateMarket.Order[] memory nextOrders = market.getBatchOrders(0, 1);
        assertEq(nextOrders.length, 1);
        assertEq(nextOrders[0].trader, alice);
        assertEq(nextOrders[0].amount, 100 ether);
        assertEq(uint8(nextOrders[0].side), uint8(PrivateMarket.Side.YES));
    }

    function test_clearBatch_partialFill_carriesRemainingAmount() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.startPrank(alice);
        wmon.approve(address(market), 1000 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 1000 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        wmon.approve(address(market), 500 ether);
        market.placeOrder(0, PrivateMarket.Side.NO, 5000, 500 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 6);
        market.clearBatch(0);

        PrivateMarket.BatchResult memory result = market.getBatchResult(0, 0);
        assertEq(result.clearingPrice, 5000);
        assertEq(result.yesVolume, 500 ether);
        assertEq(result.noVolume, 500 ether);

        PrivateMarket.Order[] memory nextOrders = market.getBatchOrders(0, 1);
        assertEq(nextOrders.length, 1);
        assertEq(nextOrders[0].trader, alice);
        assertEq(nextOrders[0].amount, 500 ether);
        assertEq(uint8(nextOrders[0].side), uint8(PrivateMarket.Side.YES));
    }

    function test_clearBatch_partialFill_proRataAcrossEligibleOrders() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.startPrank(alice);
        wmon.approve(address(market), 800 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 800 ether);
        vm.stopPrank();

        vm.startPrank(charlie);
        wmon.approve(address(market), 200 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 200 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        wmon.approve(address(market), 500 ether);
        market.placeOrder(0, PrivateMarket.Side.NO, 5000, 500 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 6);
        market.clearBatch(0);

        PrivateMarket.BatchResult memory result = market.getBatchResult(0, 0);
        assertEq(result.yesVolume, 500 ether);
        assertEq(result.noVolume, 500 ether);

        PrivateMarket.Order[] memory nextOrders = market.getBatchOrders(0, 1);
        assertEq(nextOrders.length, 2);
        assertEq(nextOrders[0].trader, alice);
        assertEq(nextOrders[0].amount, 400 ether);
        assertEq(nextOrders[1].trader, charlie);
        assertEq(nextOrders[1].amount, 100 ether);
    }

    function test_clearBatch_carriesForwardWhenPricesDoNotCross() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.startPrank(alice);
        wmon.approve(address(market), 100 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 9000, 100 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        wmon.approve(address(market), 100 ether);
        market.placeOrder(0, PrivateMarket.Side.NO, 500, 100 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 6);
        market.clearBatch(0);

        PrivateMarket.BatchResult memory result = market.getBatchResult(0, 0);
        assertEq(result.yesVolume, 0);
        assertEq(result.noVolume, 0);

        PrivateMarket.Order[] memory nextOrders = market.getBatchOrders(0, 1);
        assertEq(nextOrders.length, 2);
        assertEq(nextOrders[0].trader, alice);
        assertEq(nextOrders[0].amount, 100 ether);
        assertEq(nextOrders[1].trader, bob);
        assertEq(nextOrders[1].amount, 100 ether);
    }

    function test_cancelOrder() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.startPrank(alice);
        wmon.approve(address(market), 100 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 100 ether);
        vm.stopPrank();

        uint256 balanceBefore = wmon.balanceOf(alice);

        // Alice cancels her order
        vm.prank(alice);
        market.cancelOrder(0, 0, 0);

        uint256 balanceAfter = wmon.balanceOf(alice);
        assertEq(balanceAfter - balanceBefore, 100 ether);
    }

    function test_cancelOrder_revertsForNonOwner() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.startPrank(alice);
        wmon.approve(address(market), 100 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 100 ether);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(PrivateMarket.NotOrderOwner.selector);
        market.cancelOrder(0, 0, 0);
    }

    function test_clearBatch_revertsBeforeInterval() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.expectRevert(PrivateMarket.BatchNotReady.selector);
        market.clearBatch(0);
    }

    // ─── Resolution & Redemption ───────────────────────────

    function test_resolve() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);
        market.resolve(0, PrivateMarket.Outcome.YES);

        (,,,,, PrivateMarket.Outcome resolved,,,,) = market.getMarket(0);
        assertEq(uint8(resolved), uint8(PrivateMarket.Outcome.YES));
    }

    function test_resolve_revertsForNonAdmin() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.prank(alice);
        vm.expectRevert(PrivateMarket.OnlyAdmin.selector);
        market.resolve(0, PrivateMarket.Outcome.YES);
    }

    function test_redeem() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        // Place matching orders
        vm.startPrank(alice);
        wmon.approve(address(market), 1000 ether);
        market.placeOrder(0, PrivateMarket.Side.YES, 6000, 1000 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        wmon.approve(address(market), 500 ether);
        market.placeOrder(0, PrivateMarket.Side.NO, 5000, 500 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 6);
        market.clearBatch(0);

        // Resolve as YES
        market.resolve(0, PrivateMarket.Outcome.YES);

        // Alice redeems YES tokens
        (,, address yesToken,,,,,,,) = market.getMarket(0);
        uint256 aliceYesBalance = OutcomeToken(yesToken).balanceOf(alice);

        if (aliceYesBalance > 0) {
            uint256 wmonBefore = wmon.balanceOf(alice);

            vm.startPrank(alice);
            market.redeem(0, aliceYesBalance);
            vm.stopPrank();

            uint256 wmonAfter = wmon.balanceOf(alice);
            assertTrue(wmonAfter > wmonBefore);
        }
    }

    function test_redeem_revertsIfNotResolved() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);

        vm.prank(alice);
        vm.expectRevert(PrivateMarket.MarketNotResolved.selector);
        market.redeem(0, 100 ether);
    }

    // ─── WMON Wrap/Unwrap ─────────────────────────────────

    function test_wmonWithdraw() public {
        uint256 monBefore = alice.balance;
        vm.prank(alice);
        wmon.withdraw(1000 ether);
        assertEq(wmon.balanceOf(alice), 9000 ether);
        assertEq(alice.balance, monBefore + 1000 ether);
    }

    function test_wmonDeposit() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        wmon.deposit{value: 1 ether}();
        assertEq(wmon.balanceOf(alice), 10_001 ether);
    }

    // ─── OutcomeToken Access Control ───────────────────────

    function test_outcomeToken_onlyMarketCanMint() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);
        (,, address yesToken,,,,,,,) = market.getMarket(0);

        vm.prank(alice);
        vm.expectRevert(OutcomeToken.OnlyMarket.selector);
        OutcomeToken(yesToken).mint(alice, 100 ether);
    }

    function test_outcomeToken_onlyMarketCanBurn() public {
        market.createMarket("Test?", block.timestamp + 1 days, 5);
        (,, address yesToken,,,,,,,) = market.getMarket(0);

        vm.prank(alice);
        vm.expectRevert(OutcomeToken.OnlyMarket.selector);
        OutcomeToken(yesToken).burn(alice, 100 ether);
    }
}
