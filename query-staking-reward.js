/**
 * 이더리움 메인넷 토네이도 캐시 거버넌스 컨트랙트에서
 * 특정 지갑 주소의 스테이킹 리워드 및 잠긴 잔액을 조회하는 스크립트
 * - ethers.js v6 사용
 * - 공용 RPC 노드 사용
 */

const { ethers } = require('ethers');

// ========== 설정 ==========
const GOVERNANCE_CONTRACT_ADDRESS = '0x5efda50f2a4932a37390074c8D37FD6203E3992F';
const RPC_URL = 'https://eth.llamarpc.com'; // 공용 무료 RPC (대안: https://rpc.ankr.com/eth, https://ethereum.publicnode.com)
const TORN_DECIMALS = 18;

// 조회할 지갑 주소 (예시; 실행 시 인자로 넘기거나 여기서 수정)
const WALLET_ADDRESS = process.argv[2] || '0x0000000000000000000000000000000000000000';

// 거버넌스 컨트랙트 ABI (스테이킹 리워드·잔액 조회에 필요한 최소 항목)
const GOVERNANCE_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function rewardOf(address account) view returns (uint256)',
];

async function main() {
  if (!ethers.isAddress(WALLET_ADDRESS)) {
    console.error('오류: 유효한 지갑 주소를 입력해주세요.');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const governance = new ethers.Contract(
    GOVERNANCE_CONTRACT_ADDRESS,
    GOVERNANCE_ABI,
    provider
  );

  console.log('네트워크: Ethereum Mainnet');
  console.log('거버넌스 컨트랙트:', GOVERNANCE_CONTRACT_ADDRESS);
  console.log('조회 지갑:', WALLET_ADDRESS);
  console.log('---');

  try {
    const [lockedBalanceWei, rewardWei] = await Promise.all([
      governance.balanceOf(WALLET_ADDRESS),
      governance.rewardOf(WALLET_ADDRESS),
    ]);

    const lockedBalance = ethers.formatUnits(lockedBalanceWei, TORN_DECIMALS);
    const reward = ethers.formatUnits(rewardWei, TORN_DECIMALS);

    console.log('잠긴 TORN (스테이킹 잔액):', lockedBalance, 'TORN');
    console.log('받을 수 있는 리워드:', reward, 'TORN');
  } catch (err) {
    if (err.message && err.message.includes('call revert')) {
      console.error('컨트랙트 호출 실패. 해당 컨트랙트에 balanceOf/rewardOf가 없거나 주소가 다를 수 있습니다.');
    } else {
      console.error('조회 중 오류:', err.message || err);
    }
    process.exit(1);
  }
}

main();
