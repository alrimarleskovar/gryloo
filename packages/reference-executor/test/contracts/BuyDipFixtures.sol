// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.21;
// MOCKED ONLY: ABI-compatible deterministic fixtures, never production swap code.
contract MockDipToken {
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function init(uint8 d) external { decimals = d; }
    function mint(address to, uint256 n) external { balanceOf[to] += n; }
    function approve(address to, uint256 n) external returns (bool) { allowance[msg.sender][to] = n; return true; }
    function transferFrom(address from, address to, uint256 n) external returns (bool) {
        require(allowance[from][msg.sender] >= n && balanceOf[from] >= n, "FUNDS");
        allowance[from][msg.sender] -= n; balanceOf[from] -= n; balanceOf[to] += n; return true;
    }
}
contract MockDipPool {
    address public factory = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address public token0 = 0x4200000000000000000000000000000000000006;
    address public token1 = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint24 public fee = 500;
    uint160 public sqrt;
    int24 public tick;
    bool public unavailable;
    bool public malformed;
    function malform(bool value) external { malformed=value; }
    function init(uint160 s, int24 t) external { factory=0x33128a8fC17869897dcE68Ed026d694621f6FDfD; sqrt=s; tick=t; }
    function alter(address a,address b,uint24 f,bool u) external { token0=a;token1=b;fee=f;unavailable=u; }
    function slot0() external view returns(uint160,int24,uint16,uint16,uint16,uint8,bool) {
        require(!unavailable,"UNAVAILABLE");if(malformed) { assembly { return(0, 32) } } return(sqrt,tick,0,1,1,0,true);
    }
}
contract MockDipFactory {
    address public pool;
    function init(address a) external { pool=a; }
    function getPool(address,address,uint24) external view returns(address) { return pool; }
}
contract MockDipRouter {
    uint256 public swaps;
    struct Swap { address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 minimum; uint160 limit; }
    function multicall(uint256 deadline, bytes[] calldata calls) external payable returns(bytes[] memory results) {
        require(block.timestamp <= deadline && msg.value == 0,"DEADLINE");
        results=new bytes[](calls.length);
        for(uint256 i;i<calls.length;i++) {
            (bool ok,bytes memory result)=address(this).delegatecall(calls[i]);require(ok,"CALL");results[i]=result;
        }
    }
    function exactInputSingle(Swap calldata s) external returns(uint256 amountOut) {
        require(s.fee==500&&s.limit==0,"PARAMS");amountOut=1000;require(amountOut>=s.minimum,"MINIMUM");
        MockDipToken(s.tokenIn).transferFrom(msg.sender,address(this),s.amountIn);
        MockDipToken(s.tokenOut).mint(s.recipient,amountOut);swaps++;
    }
}
