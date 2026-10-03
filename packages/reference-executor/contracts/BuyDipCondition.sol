// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.21;

/// BUILD-016: read-only Zodiac Roles 2.1.0 Custom condition. No send, token
/// transfer, approval, budget mutation, owner key or generic oracle interface.
contract BuyDipCondition {
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;

    struct Terms {
        address roles;
        address pool;
        bytes32 poolCodeHash;
        bytes32 policyHash;
        bytes32 manifestHash;
        bytes32 referenceHash;
        bytes32 referenceBlockHash;
        uint256 referenceBlock;
        uint256 referenceSqrt;
        uint256 referenceTimestamp;
        uint256 startsAt;
        uint256 expiresAt;
        uint256 maximumAgeSeconds;
        bytes32 swapHash;
    }
    Terms public terms;

    constructor(Terms memory t) {
        require(block.chainid == 31337 && t.roles.code.length != 0, "CHAIN_OR_ROLES");
        require(t.policyHash != 0 && t.manifestHash != 0 && t.referenceHash != 0, "BINDING");
        require(t.referenceBlock < block.number && block.number - t.referenceBlock <= 256 &&
            blockhash(t.referenceBlock) == t.referenceBlockHash, "REFERENCE");
        require(t.referenceSqrt > 4295128739 && t.referenceSqrt < 2**120 &&
            t.startsAt < t.expiresAt && t.maximumAgeSeconds > 0 && t.maximumAgeSeconds <= 60, "TERMS");
        terms = t; // no setter or upgrade/admin path
        require(_identity(t), "SOURCE");
        require(block.timestamp >= t.referenceTimestamp &&
            block.timestamp < t.referenceTimestamp + t.maximumAgeSeconds, "STALE_REFERENCE");
        (bool referenceOk, bytes memory referenceSlot) = t.pool.staticcall(abi.encodeWithSignature("slot0()"));
        require(referenceOk && referenceSlot.length == 224 &&
            _validSlot(referenceSlot) && abi.decode(referenceSlot, (uint256)) == t.referenceSqrt, "REFERENCE_VALUE");
    }

    function _uint(address target, bytes4 selector) private view returns (bool, uint256) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || data.length != 32) return (false, 0);
        return (true, abi.decode(data, (uint256)));
    }
    function _identity(Terms memory t) private view returns (bool) {
        if (t.pool.codehash != t.poolCodeHash) return false;
        (bool a, uint256 factory) = _uint(t.pool, bytes4(keccak256("factory()")));
        (bool b, uint256 token0) = _uint(t.pool, bytes4(keccak256("token0()")));
        (bool c, uint256 token1) = _uint(t.pool, bytes4(keccak256("token1()")));
        (bool d, uint256 fee) = _uint(t.pool, bytes4(keccak256("fee()")));
        (bool e, uint256 dec0) = _uint(WETH, bytes4(keccak256("decimals()")));
        (bool f, uint256 dec1) = _uint(USDC, bytes4(keccak256("decimals()")));
        (bool ok, bytes memory found) = FACTORY.staticcall(abi.encodeWithSignature("getPool(address,address,uint24)", WETH, USDC, uint24(500)));
        return a && b && c && d && e && f && factory == uint160(FACTORY) &&
            token0 == uint160(WETH) && token1 == uint160(USDC) && fee == 500 && dec0 == 18 && dec1 == 6 &&
            ok && found.length == 32 && abi.decode(found, (uint256)) == uint160(t.pool);
    }

    function _validSlot(bytes memory slot) private pure returns (bool) {
        if (slot.length != 224) return false;
        uint256 sqrt; int256 tick; uint256 index; uint256 count; uint256 next; uint256 protocolFee; uint256 unlocked;
        assembly {
            sqrt := mload(add(slot, 32)) tick := mload(add(slot, 64))
            index := mload(add(slot, 96)) count := mload(add(slot, 128)) next := mload(add(slot, 160))
            protocolFee := mload(add(slot, 192)) unlocked := mload(add(slot, 224))
        }
        return sqrt > 4295128739 && sqrt < 2**120 && tick >= -887272 && tick <= 887272 &&
            index <= 65535 && count > 0 && count <= 65535 && next >= count && next <= 65535 &&
            protocolFee <= 255 && unlocked == 1;
    }

    /// Exact ABI of Roles ICustomCondition, defined locally without importing
    /// another module. A public answer does not confer any financial authority.
    function check(address to, uint256 value, bytes calldata data, uint8 operation,
        uint256, uint256, bytes12 extra) external view returns (bool success, bytes32 reason) {
        Terms memory t = terms;
        if (msg.sender != t.roles || block.chainid != 31337 || to != ROUTER || value != 0 || operation != 0 ||
            keccak256(data) != t.swapHash || extra != bytes12(t.policyHash) ||
            block.timestamp < t.startsAt || block.timestamp >= t.expiresAt || !_identity(t))
            return (false, bytes32("AUTHORITY_OR_SOURCE"));
        // This is a fresh synchronous state read in the execution block, not a
        // caller-supplied monitoring snapshot. Unavailable/malformed reads fail.
        (bool ok, bytes memory slot) = t.pool.staticcall(abi.encodeWithSignature("slot0()"));
        if (!ok || slot.length != 224) return (false, bytes32("OBSERVATION_INVALID"));
        if (!_validSlot(slot)) return (false, bytes32("OBSERVATION_INVALID"));
        uint256 sqrt = abi.decode(slot, (uint256));
        // WETH token0 / USDC token1: decimal factors cancel against reference.
        // The explicit 120-bit bounds keep both squared products within uint256.
        success = sqrt * sqrt * 100 <= t.referenceSqrt * t.referenceSqrt * 95;
        return (success, success ? bytes32(0) : bytes32("TRIGGER_NOT_MET"));
    }
}
