// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {VillageToken} from "../src/VillageToken.sol";
import {VaultMultisig, IERC20} from "../src/VaultMultisig.sol";

contract VaultMultisigTest is Test {
    VillageToken token;
    VaultMultisig vault;
    address[] owners;
    address a = makeAddr("alice");
    address b = makeAddr("bob");
    address c = makeAddr("carol");
    address d = makeAddr("dave");
    address outsider = makeAddr("outsider");

    function setUp() public {
        owners = [a, b, c, d];
        token = new VillageToken();
        vault = _deploy(0, 0);
    }

    function _deploy(uint256 petty, uint256 epoch) internal returns (VaultMultisig v) {
        v = new VaultMultisig(owners, 3, IERC20(address(token)), petty, epoch);
        token.mint(address(v), 1000 ether);
    }

    function test_threeApprovalsExecutes() public {
        vm.prank(a);
        uint256 id = vault.propose(outsider, 100 ether, "pay vendor");
        vm.prank(b);
        vault.approve(id);
        vm.prank(c);
        vault.approve(id);
        vm.prank(d);
        vault.execute(id);
        assertEq(token.balanceOf(outsider), 100 ether);
        assertEq(token.balanceOf(address(vault)), 900 ether);
        assertTrue(vault.getProposal(id).executed);
    }

    function test_twoApprovalsCannotExecute() public {
        vm.prank(a);
        uint256 id = vault.propose(outsider, 100 ether, "x");
        vm.prank(b);
        vault.approve(id);
        vm.prank(a);
        vm.expectRevert("below threshold");
        vault.execute(id);
    }

    function test_nonOwnerRejected() public {
        vm.prank(outsider);
        vm.expectRevert("not owner");
        vault.propose(outsider, 1, "x");
    }

    function test_doubleApproveRejected() public {
        vm.prank(a);
        uint256 id = vault.propose(outsider, 1, "x");
        vm.prank(a);
        vm.expectRevert("already approved");
        vault.approve(id);
    }

    function test_revokeDropsBelowThreshold() public {
        vm.prank(a);
        uint256 id = vault.propose(outsider, 1, "x");
        vm.prank(b);
        vault.approve(id);
        vm.prank(c);
        vault.approve(id);
        vm.prank(c);
        vault.revoke(id);
        vm.prank(a);
        vm.expectRevert("below threshold");
        vault.execute(id);
    }

    function test_cannotExecuteTwice() public {
        vm.prank(a);
        uint256 id = vault.propose(outsider, 1, "x");
        vm.prank(b);
        vault.approve(id);
        vm.prank(c);
        vault.approve(id);
        vm.prank(a);
        vault.execute(id);
        vm.prank(a);
        vm.expectRevert("executed");
        vault.execute(id);
    }

    function test_pettyCashDisabledByDefault() public {
        vm.prank(a);
        vm.expectRevert("petty cash disabled");
        vault.pettyWithdraw(a, 1);
    }

    function test_pettyCashBudgetAndEpochReset() public {
        VaultMultisig v = _deploy(10 ether, 1 hours);
        vm.startPrank(a);
        v.pettyWithdraw(a, 6 ether);
        v.pettyWithdraw(a, 4 ether);
        vm.expectRevert("petty cash exceeded");
        v.pettyWithdraw(a, 1);
        vm.warp(block.timestamp + 1 hours);
        v.pettyWithdraw(a, 10 ether);
        vm.stopPrank();
        assertEq(token.balanceOf(a), 20 ether);
    }
}
