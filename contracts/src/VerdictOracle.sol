// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title VerdictOracle
/// @notice Onchain record of verdictagent token verdicts on Robinhood Chain.
///         Anyone can read the latest verdict for a token and re-derive it off-chain:
///         `inputsHash` commits to the exact inputs the deterministic engine scored.
/// @dev    Design constraints, on purpose:
///         - holds no funds: there is no payable function, no receive and no fallback;
///         - not upgradeable: the audited bytecode is the running bytecode;
///         - two roles: the owner (meant to be a multisig) manages attesters and can pause,
///           attesters (the verdictagent server key) can only write verdicts;
///         - verdicts per token only move forward in time, so an old signed verdict
///           can never be replayed over a newer one.
contract VerdictOracle {
    /// @notice Same order as the off-chain engine labels.
    enum Label {
        HEALTHY,
        WATCH,
        DECAYING,
        COLLAPSING,
        DEAD
    }

    /// @notice One verdict. Stored in four slots (24 bytes of small fields, two hashes, the attester).
    struct Verdict {
        uint8 score; // 0..100
        Label label;
        uint16 confidenceBps; // 0..10000 (1.0 = 10000)
        uint32 flags; // bitmask, see FLAG_* constants
        uint64 evaluatedAt; // unix seconds when the engine evaluated the inputs
        uint64 sourceBlock; // block of this chain the inputs were read at
        bytes32 inputsHash; // keccak256 of the canonical JSON inputs
        bytes32 engineVersion; // e.g. bytes32("1.0.0")
        address attester; // set by the contract, ignored on input
    }

    struct Release {
        bytes32 version;
        uint64 notarizedAt;
    }

    // flag bits, mirrored by the engine
    uint32 public constant FLAG_PUMP_EXHAUSTED = 1 << 0;
    uint32 public constant FLAG_MC_COLLAPSED = 1 << 1;
    uint32 public constant FLAG_THIN = 1 << 2;
    uint32 public constant FLAG_INSIDER_HEAVY = 1 << 3;
    uint32 public constant FLAG_WASH_SUSPECT = 1 << 4;
    uint32 public constant FLAG_BUNDLED = 1 << 5;
    uint32 public constant FLAG_FRESH = 1 << 6;
    uint32 public constant FLAG_LOW_CONFIDENCE = 1 << 7;
    uint32 public constant KNOWN_FLAGS = (1 << 8) - 1;

    /// @notice how far in the future `evaluatedAt` may be, to absorb clock skew
    uint64 public constant MAX_CLOCK_SKEW = 5 minutes;
    uint256 public constant MAX_BATCH = 50;

    address public owner;
    address public pendingOwner;
    bool public paused;
    mapping(address account => bool) public isAttester;
    mapping(bytes32 sha256Hash => Release) public releases;
    mapping(address token => Verdict) private _latest;

    event VerdictAttested(
        address indexed token,
        address indexed attester,
        uint8 score,
        Label label,
        uint16 confidenceBps,
        uint32 flags,
        uint64 evaluatedAt,
        uint64 sourceBlock,
        bytes32 inputsHash,
        bytes32 engineVersion
    );
    event AttesterSet(address indexed account, bool allowed);
    event PausedSet(bool paused);
    event ReleaseNotarized(bytes32 indexed sha256Hash, bytes32 version);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error NotAttester();
    error IsPaused();
    error ZeroAddress();
    error ScoreOutOfRange(uint8 score);
    error ConfidenceOutOfRange(uint16 confidenceBps);
    error UnknownFlags(uint32 flags);
    error EmptyInputsHash();
    error EvaluatedInFuture(uint64 evaluatedAt);
    error NotNewer(uint64 evaluatedAt, uint64 latest);
    error LengthMismatch();
    error BatchTooLarge(uint256 size);
    error ReleaseExists(bytes32 sha256Hash);
    error EmptyRelease();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttester() {
        if (!isAttester[msg.sender]) revert NotAttester();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    // ───────────────────────── writes ─────────────────────────

    /// @notice Record the latest verdict for `token`.
    function attest(address token, Verdict calldata v) external onlyAttester whenNotPaused {
        _attest(token, v);
    }

    /// @notice Record several verdicts in one transaction (max 50). Reverts atomically.
    function attestBatch(address[] calldata tokens, Verdict[] calldata vs) external onlyAttester whenNotPaused {
        if (tokens.length != vs.length) revert LengthMismatch();
        if (tokens.length > MAX_BATCH) revert BatchTooLarge(tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            _attest(tokens[i], vs[i]);
        }
    }

    function _attest(address token, Verdict calldata v) private {
        if (token == address(0)) revert ZeroAddress();
        if (v.score > 100) revert ScoreOutOfRange(v.score);
        if (v.confidenceBps > 10_000) revert ConfidenceOutOfRange(v.confidenceBps);
        if (v.flags & ~KNOWN_FLAGS != 0) revert UnknownFlags(v.flags);
        if (v.inputsHash == bytes32(0)) revert EmptyInputsHash();
        if (v.evaluatedAt > block.timestamp + MAX_CLOCK_SKEW) revert EvaluatedInFuture(v.evaluatedAt);
        uint64 latest = _latest[token].evaluatedAt;
        if (v.evaluatedAt <= latest) revert NotNewer(v.evaluatedAt, latest);

        _latest[token] = Verdict({
            score: v.score,
            label: v.label,
            confidenceBps: v.confidenceBps,
            flags: v.flags,
            evaluatedAt: v.evaluatedAt,
            sourceBlock: v.sourceBlock,
            inputsHash: v.inputsHash,
            engineVersion: v.engineVersion,
            attester: msg.sender
        });
        emit VerdictAttested(
            token, msg.sender, v.score, v.label, v.confidenceBps, v.flags, v.evaluatedAt, v.sourceBlock, v.inputsHash, v.engineVersion
        );
    }

    /// @notice Notarize a release artifact hash (sha256 of the tarball). Write-once per hash.
    function notarizeRelease(bytes32 sha256Hash, bytes32 version) external onlyOwner {
        if (sha256Hash == bytes32(0) || version == bytes32(0)) revert EmptyRelease();
        if (releases[sha256Hash].notarizedAt != 0) revert ReleaseExists(sha256Hash);
        releases[sha256Hash] = Release({version: version, notarizedAt: uint64(block.timestamp)});
        emit ReleaseNotarized(sha256Hash, version);
    }

    // ───────────────────────── reads ─────────────────────────

    /// @notice Latest verdict for `token`. `evaluatedAt == 0` means none was ever recorded.
    function verdictOf(address token) external view returns (Verdict memory) {
        return _latest[token];
    }

    /// @notice Convenience guard for other contracts, e.g. a router refusing to swap into dying tokens.
    /// @return ok true when a verdict exists, is at most `maxAge` seconds old, scores at least
    ///         `minScore`, and is not labelled COLLAPSING or DEAD.
    function isHealthy(address token, uint8 minScore, uint64 maxAge) external view returns (bool ok) {
        Verdict storage v = _latest[token];
        if (v.evaluatedAt == 0) return false;
        if (block.timestamp > uint256(v.evaluatedAt) + maxAge) return false;
        if (v.label == Label.COLLAPSING || v.label == Label.DEAD) return false;
        return v.score >= minScore;
    }

    // ───────────────────────── admin ─────────────────────────

    function setAttester(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isAttester[account] = allowed;
        emit AttesterSet(account, allowed);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Two-step ownership transfer; the new owner must call acceptOwnership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
