// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @notice N-of-M treasury that can only move a single ERC20.
/// Loophole knobs (off when zero):
///  - pettyCashPerEpoch: each owner may withdraw up to this much per epoch with no vote.
/// Built-in social loophole: `description` is free text and never checked against to/amount.
contract VaultMultisig {
    struct Proposal {
        address proposer;
        address to;
        uint256 amount;
        string description;
        uint256 approvals;
        bool executed;
        uint64 createdAt;
    }

    IERC20 public immutable token;
    uint256 public immutable threshold;
    uint256 public immutable pettyCashPerEpoch;
    uint256 public immutable epochLength;
    uint256 public immutable startTime;

    address[] private _owners;
    mapping(address => bool) public isOwner;

    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasApproved;
    // owner => epoch => amount withdrawn
    mapping(address => mapping(uint256 => uint256)) public pettySpent;

    event Proposed(uint256 indexed id, address indexed proposer, address to, uint256 amount, string description);
    event Approved(uint256 indexed id, address indexed owner, uint256 approvals);
    event Revoked(uint256 indexed id, address indexed owner, uint256 approvals);
    event Executed(uint256 indexed id, address indexed executor, address to, uint256 amount);
    event PettyWithdrawn(address indexed owner, address to, uint256 amount, uint256 epoch);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    constructor(
        address[] memory owners_,
        uint256 threshold_,
        IERC20 token_,
        uint256 pettyCashPerEpoch_,
        uint256 epochLength_
    ) {
        require(threshold_ > 0 && threshold_ <= owners_.length, "bad threshold");
        require(pettyCashPerEpoch_ == 0 || epochLength_ > 0, "bad epoch");
        for (uint256 i = 0; i < owners_.length; i++) {
            address o = owners_[i];
            require(o != address(0) && !isOwner[o], "bad owner");
            isOwner[o] = true;
            _owners.push(o);
        }
        token = token_;
        threshold = threshold_;
        pettyCashPerEpoch = pettyCashPerEpoch_;
        epochLength = epochLength_;
        startTime = block.timestamp;
    }

    function propose(address to, uint256 amount, string calldata description) external onlyOwner returns (uint256 id) {
        require(to != address(0), "zero to");
        require(amount > 0, "zero amount");
        id = _proposals.length;
        _proposals.push(
            Proposal({
                proposer: msg.sender,
                to: to,
                amount: amount,
                description: description,
                approvals: 0,
                executed: false,
                createdAt: uint64(block.timestamp)
            })
        );
        emit Proposed(id, msg.sender, to, amount, description);
        _approve(id);
    }

    function approve(uint256 id) external onlyOwner {
        _approve(id);
    }

    function revoke(uint256 id) external onlyOwner {
        Proposal storage p = _get(id);
        require(!p.executed, "executed");
        require(hasApproved[id][msg.sender], "not approved");
        hasApproved[id][msg.sender] = false;
        p.approvals--;
        emit Revoked(id, msg.sender, p.approvals);
    }

    function execute(uint256 id) external onlyOwner {
        Proposal storage p = _get(id);
        require(!p.executed, "executed");
        require(p.approvals >= threshold, "below threshold");
        p.executed = true;
        require(token.transfer(p.to, p.amount), "transfer failed");
        emit Executed(id, msg.sender, p.to, p.amount);
    }

    function pettyWithdraw(address to, uint256 amount) external onlyOwner {
        require(pettyCashPerEpoch > 0, "petty cash disabled");
        uint256 epoch = currentEpoch();
        uint256 spent = pettySpent[msg.sender][epoch] + amount;
        require(spent <= pettyCashPerEpoch, "petty cash exceeded");
        pettySpent[msg.sender][epoch] = spent;
        require(token.transfer(to, amount), "transfer failed");
        emit PettyWithdrawn(msg.sender, to, amount, epoch);
    }

    function currentEpoch() public view returns (uint256) {
        return epochLength == 0 ? 0 : (block.timestamp - startTime) / epochLength;
    }

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return _get(id);
    }

    function _approve(uint256 id) internal {
        Proposal storage p = _get(id);
        require(!p.executed, "executed");
        require(!hasApproved[id][msg.sender], "already approved");
        hasApproved[id][msg.sender] = true;
        p.approvals++;
        emit Approved(id, msg.sender, p.approvals);
    }

    function _get(uint256 id) internal view returns (Proposal storage) {
        require(id < _proposals.length, "no proposal");
        return _proposals[id];
    }
}
