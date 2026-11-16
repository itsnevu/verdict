// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VerdictOracle} from "../src/VerdictOracle.sol";

contract VerdictOracleTest is Test {
    VerdictOracle oracle;
    address owner = makeAddr("owner");
    address attester = makeAddr("attester");
    address stranger = makeAddr("stranger");
    address token = makeAddr("token");

    event VerdictAttested(
        address indexed token,
        address indexed attester,
        uint8 score,
        VerdictOracle.Label label,
        uint16 confidenceBps,
        uint32 flags,
        uint64 evaluatedAt,
        uint64 sourceBlock,
        bytes32 inputsHash,
        bytes32 engineVersion
    );

    function setUp() public {
        vm.warp(1_763_300_000);
        oracle = new VerdictOracle(owner);
        vm.prank(owner);
        oracle.setAttester(attester, true);
    }

    function _v(uint8 score, VerdictOracle.Label label, uint64 at) internal pure returns (VerdictOracle.Verdict memory) {
        return VerdictOracle.Verdict({
            score: score,
            label: label,
            confidenceBps: 8000,
            flags: uint32(1 << 2) | uint32(1 << 0), // THIN | PUMP_EXHAUSTED (literal: an external call here would consume vm.prank)
            evaluatedAt: at,
            sourceBlock: 115_827_816,
            inputsHash: keccak256(abi.encode(score, at)),
            engineVersion: bytes32("1.0.0"),
            attester: address(0xdead) // must be ignored
        });
    }

    // ── happy path ──

    function test_attest_storesVerdictAndEmits() public {
        VerdictOracle.Verdict memory v = _v(31, VerdictOracle.Label.COLLAPSING, uint64(block.timestamp));
        vm.expectEmit(true, true, false, true, address(oracle));
        emit VerdictAttested(token, attester, 31, VerdictOracle.Label.COLLAPSING, 8000, v.flags, v.evaluatedAt, v.sourceBlock, v.inputsHash, v.engineVersion);
        vm.prank(attester);
        oracle.attest(token, v);

        VerdictOracle.Verdict memory got = oracle.verdictOf(token);
        assertEq(got.score, 31);
        assertEq(uint8(got.label), uint8(VerdictOracle.Label.COLLAPSING));
        assertEq(got.inputsHash, v.inputsHash);
        assertEq(got.attester, attester, "attester comes from msg.sender, not input");
    }

    function test_verdictOf_unknownTokenIsEmpty() public view {
        assertEq(oracle.verdictOf(stranger).evaluatedAt, 0);
        assertFalse(oracle.isHealthy(stranger, 0, type(uint64).max));
    }

    function test_attestBatch() public {
        address[] memory tokens = new address[](2);
        tokens[0] = token;
        tokens[1] = makeAddr("token2");
        VerdictOracle.Verdict[] memory vs = new VerdictOracle.Verdict[](2);
        vs[0] = _v(80, VerdictOracle.Label.HEALTHY, uint64(block.timestamp));
        vs[1] = _v(10, VerdictOracle.Label.DEAD, uint64(block.timestamp));
        vm.prank(attester);
        oracle.attestBatch(tokens, vs);
        assertEq(oracle.verdictOf(tokens[1]).score, 10);
    }

    // ── access control ──

    function test_onlyAttesterCanWrite() public {
        vm.prank(stranger);
        vm.expectRevert(VerdictOracle.NotAttester.selector);
        oracle.attest(token, _v(50, VerdictOracle.Label.DECAYING, uint64(block.timestamp)));
    }

    function test_revokedAttesterCannotWrite() public {
        vm.prank(owner);
        oracle.setAttester(attester, false);
        vm.prank(attester);
        vm.expectRevert(VerdictOracle.NotAttester.selector);
        oracle.attest(token, _v(50, VerdictOracle.Label.DECAYING, uint64(block.timestamp)));
    }

    function test_onlyOwnerAdmin() public {
        vm.startPrank(stranger);
        vm.expectRevert(VerdictOracle.NotOwner.selector);
        oracle.setAttester(stranger, true);
        vm.expectRevert(VerdictOracle.NotOwner.selector);
        oracle.setPaused(true);
        vm.expectRevert(VerdictOracle.NotOwner.selector);
        oracle.transferOwnership(stranger);
        vm.expectRevert(VerdictOracle.NotOwner.selector);
        oracle.notarizeRelease(bytes32(uint256(1)), bytes32("3.0.0"));
        vm.stopPrank();
    }

    function test_attesterCannotAdmin() public {
        vm.prank(attester);
        vm.expectRevert(VerdictOracle.NotOwner.selector);
        oracle.setAttester(stranger, true);
    }

    function test_zeroAddressesRejected() public {
        vm.expectRevert(VerdictOracle.ZeroAddress.selector);
        new VerdictOracle(address(0));
        vm.prank(owner);
        vm.expectRevert(VerdictOracle.ZeroAddress.selector);
        oracle.setAttester(address(0), true);
        vm.prank(attester);
        vm.expectRevert(VerdictOracle.ZeroAddress.selector);
        oracle.attest(address(0), _v(50, VerdictOracle.Label.DECAYING, uint64(block.timestamp)));
    }

    // ── pause ──

    function test_pauseBlocksWritesNotReads() public {
        vm.prank(attester);
        oracle.attest(token, _v(70, VerdictOracle.Label.WATCH, uint64(block.timestamp)));
        vm.prank(owner);
        oracle.setPaused(true);
        vm.warp(block.timestamp + 10);
        vm.prank(attester);
        vm.expectRevert(VerdictOracle.IsPaused.selector);
        oracle.attest(token, _v(71, VerdictOracle.Label.WATCH, uint64(block.timestamp)));
        assertEq(oracle.verdictOf(token).score, 70);
        vm.prank(owner);
        oracle.setPaused(false);
        vm.prank(attester);
        oracle.attest(token, _v(71, VerdictOracle.Label.WATCH, uint64(block.timestamp)));
    }

    // ── validation ──

    function test_rejectsBadValues() public {
        uint64 t = uint64(block.timestamp);
        vm.startPrank(attester);
        VerdictOracle.Verdict memory v = _v(101, VerdictOracle.Label.HEALTHY, t);
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.ScoreOutOfRange.selector, uint8(101)));
        oracle.attest(token, v);

        v = _v(50, VerdictOracle.Label.DECAYING, t);
        v.confidenceBps = 10_001;
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.ConfidenceOutOfRange.selector, uint16(10_001)));
        oracle.attest(token, v);

        v = _v(50, VerdictOracle.Label.DECAYING, t);
        v.flags = 1 << 8;
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.UnknownFlags.selector, uint32(1 << 8)));
        oracle.attest(token, v);

        v = _v(50, VerdictOracle.Label.DECAYING, t);
        v.inputsHash = bytes32(0);
        vm.expectRevert(VerdictOracle.EmptyInputsHash.selector);
        oracle.attest(token, v);

        v = _v(50, VerdictOracle.Label.DECAYING, t + 301);
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.EvaluatedInFuture.selector, t + 301));
        oracle.attest(token, v);
        vm.stopPrank();
    }

    function test_invalidEnumRevertsAtDecoding() public {
        // label = 5 is outside the enum; ABI decoding must reject it
        bytes memory data = abi.encodeWithSelector(
            VerdictOracle.attest.selector, token, uint8(50), uint8(5), uint16(1), uint32(0), uint64(block.timestamp), uint64(1), bytes32(uint256(1)), bytes32("1.0.0"), address(0)
        );
        vm.prank(attester);
        (bool ok,) = address(oracle).call(data);
        assertFalse(ok);
    }

    function test_noReplayOfOlderOrEqualVerdicts() public {
        uint64 t = uint64(block.timestamp);
        vm.startPrank(attester);
        oracle.attest(token, _v(80, VerdictOracle.Label.HEALTHY, t));
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.NotNewer.selector, t, t));
        oracle.attest(token, _v(10, VerdictOracle.Label.DEAD, t));
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.NotNewer.selector, t - 1, t));
        oracle.attest(token, _v(10, VerdictOracle.Label.DEAD, t - 1));
        vm.stopPrank();
        assertEq(oracle.verdictOf(token).score, 80);
    }

    function test_batchValidation() public {
        address[] memory tokens = new address[](2);
        VerdictOracle.Verdict[] memory vs = new VerdictOracle.Verdict[](1);
        vm.startPrank(attester);
        vm.expectRevert(VerdictOracle.LengthMismatch.selector);
        oracle.attestBatch(tokens, vs);
        address[] memory big = new address[](51);
        VerdictOracle.Verdict[] memory bigV = new VerdictOracle.Verdict[](51);
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.BatchTooLarge.selector, uint256(51)));
        oracle.attestBatch(big, bigV);
        vm.stopPrank();
    }

    function test_batchIsAtomic() public {
        address[] memory tokens = new address[](2);
        tokens[0] = token;
        tokens[1] = makeAddr("token2");
        VerdictOracle.Verdict[] memory vs = new VerdictOracle.Verdict[](2);
        vs[0] = _v(80, VerdictOracle.Label.HEALTHY, uint64(block.timestamp));
        vs[1] = _v(101, VerdictOracle.Label.HEALTHY, uint64(block.timestamp)); // invalid
        vm.prank(attester);
        vm.expectRevert();
        oracle.attestBatch(tokens, vs);
        assertEq(oracle.verdictOf(token).evaluatedAt, 0, "first item must roll back");
    }

    // ── isHealthy ──

    function test_isHealthy() public {
        vm.prank(attester);
        oracle.attest(token, _v(80, VerdictOracle.Label.HEALTHY, uint64(block.timestamp)));
        assertTrue(oracle.isHealthy(token, 75, 1 hours));
        assertFalse(oracle.isHealthy(token, 81, 1 hours), "below min score");
        vm.warp(block.timestamp + 1 hours + 1);
        assertFalse(oracle.isHealthy(token, 75, 1 hours), "stale");
        vm.prank(attester);
        oracle.attest(token, _v(90, VerdictOracle.Label.COLLAPSING, uint64(block.timestamp)));
        assertFalse(oracle.isHealthy(token, 0, 1 hours), "collapsing never healthy");
    }

    // ── releases ──

    function test_notarizeRelease() public {
        bytes32 h = sha256("verdict-3.0.0.tgz");
        vm.prank(owner);
        oracle.notarizeRelease(h, bytes32("3.0.0"));
        (bytes32 version, uint64 at) = oracle.releases(h);
        assertEq(version, bytes32("3.0.0"));
        assertEq(at, block.timestamp);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.ReleaseExists.selector, h));
        oracle.notarizeRelease(h, bytes32("3.0.1"));
        vm.prank(owner);
        vm.expectRevert(VerdictOracle.EmptyRelease.selector);
        oracle.notarizeRelease(bytes32(0), bytes32("x"));
    }

    // ── ownership ──

    function test_twoStepOwnership() public {
        address next = makeAddr("multisig");
        vm.prank(owner);
        oracle.transferOwnership(next);
        assertEq(oracle.owner(), owner, "unchanged until accepted");
        vm.prank(stranger);
        vm.expectRevert(VerdictOracle.NotPendingOwner.selector);
        oracle.acceptOwnership();
        vm.prank(next);
        oracle.acceptOwnership();
        assertEq(oracle.owner(), next);
        assertEq(oracle.pendingOwner(), address(0));
        vm.prank(owner);
        vm.expectRevert(VerdictOracle.NotOwner.selector);
        oracle.setPaused(true);
    }

    // ── no funds ──

    function test_rejectsEther() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(oracle).call{value: 1 wei}("");
        assertFalse(ok, "plain transfer must fail");
        vm.prank(stranger);
        (ok,) = address(oracle).call{value: 1 wei}(abi.encodeWithSelector(oracle.setPaused.selector, true));
        assertFalse(ok, "non-payable function must reject value");
        assertEq(address(oracle).balance, 0);
    }

    // ── fuzz ──

    function testFuzz_validVerdictRoundTrips(uint8 score, uint8 labelRaw, uint16 conf, uint32 flags, uint64 dt, bytes32 h) public {
        score = uint8(bound(score, 0, 100));
        VerdictOracle.Label label = VerdictOracle.Label(bound(labelRaw, 0, 4));
        conf = uint16(bound(conf, 0, 10_000));
        flags = flags & oracle.KNOWN_FLAGS();
        vm.assume(h != bytes32(0));
        uint64 at = uint64(bound(dt, 1, block.timestamp + 300));
        VerdictOracle.Verdict memory v = _v(score, label, at);
        v.confidenceBps = conf;
        v.flags = flags;
        v.inputsHash = h;
        vm.prank(attester);
        oracle.attest(token, v);
        VerdictOracle.Verdict memory got = oracle.verdictOf(token);
        assertEq(got.score, score);
        assertEq(uint8(got.label), uint8(label));
        assertEq(got.confidenceBps, conf);
        assertEq(got.flags, flags);
        assertEq(got.inputsHash, h);
    }

    function testFuzz_outOfRangeScoreAlwaysReverts(uint8 score) public {
        score = uint8(bound(score, 101, 255));
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(VerdictOracle.ScoreOutOfRange.selector, score));
        oracle.attest(token, _v(score, VerdictOracle.Label.HEALTHY, uint64(block.timestamp)));
    }

    function testFuzz_strangersNeverWrite(address who) public {
        vm.assume(who != attester);
        vm.prank(who);
        vm.expectRevert(VerdictOracle.NotAttester.selector);
        oracle.attest(token, _v(50, VerdictOracle.Label.DECAYING, uint64(block.timestamp)));
    }

    function testFuzz_onlyForwardInTime(uint64 first, uint64 second) public {
        first = uint64(bound(first, 1, block.timestamp));
        second = uint64(bound(second, 1, block.timestamp));
        vm.startPrank(attester);
        oracle.attest(token, _v(50, VerdictOracle.Label.DECAYING, first));
        if (second <= first) vm.expectRevert(abi.encodeWithSelector(VerdictOracle.NotNewer.selector, second, first));
        oracle.attest(token, _v(60, VerdictOracle.Label.WATCH, second));
        vm.stopPrank();
        assertEq(oracle.verdictOf(token).evaluatedAt, second > first ? second : first);
    }
}
