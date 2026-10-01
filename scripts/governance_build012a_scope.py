"""DEC-0056: single BUILD-012A allowance, exact baseline/branch/files only.

No category or directory is added to the ordinary UX policy. Privileged source
permissions below apply only to the reviewed, byte-pinned files; a source edit
must pass a new purpose review and update its pin before this build can pass.
Dependency, historical, wallet-provider and frozen-contract controls remain.
"""
import hashlib
import json
import re

BASE = '64a0a46f45532d667e226193f29529d8938acf15'
REF = 'codex/build-012a-aave-v3-supply'
EVIDENCE = 'docs/builds/BUILD-012A-EVIDENCE.json'
CREATE = {'apps/reference-dapp/e2e/supply-fixtures.ts',
 'apps/reference-dapp/e2e/supply-harness.mjs',
 'apps/reference-dapp/e2e/supply-recovery.spec.ts',
 'apps/reference-dapp/e2e/supply.spec.ts',
 'apps/reference-dapp/src/app/supply-action.ts',
 'apps/reference-dapp/src/components/supply-panel.tsx',
 'apps/reference-dapp/src/domain/supply-authoring.test.ts',
 'apps/reference-dapp/src/domain/supply-authoring.ts',
 'apps/reference-dapp/src/server/supply-service.test.ts',
 'apps/reference-dapp/src/server/supply-service.ts',
 'apps/reference-dapp/src/state/supply-store.tsx',
 'docs/builds/BUILD-012A-EVIDENCE.json',
 'docs/builds/BUILD-012A-PLAN.md',
 'docs/builds/BUILD-012A-REPORT.md',
 'docs/contracts/AAVE_V3_SUPPLY_V1.md',
 'packages/action-registry/src/aave-v3-testnet.ts',
 'packages/action-registry/test/supply.test.ts',
 'packages/reference-compiler/src/supply.ts',
 'packages/reference-compiler/test/supply.test.ts',
 'packages/reference-executor/src/supply.ts',
 'packages/reference-executor/test/supply.test.ts',
 'packages/reference-linter/src/supply.ts',
 'packages/reference-linter/test/supply.test.ts',
 'packages/reference-reconciler/src/supply.ts',
 'packages/reference-reconciler/test/supply.test.ts',
 'packages/workflow-contracts/src/supply.ts',
 'packages/workflow-contracts/test/supply.test.ts',
 'scripts/governance_build012a_scope.py',
 'scripts/test_governance_build012a_scope.py'}
MODIFY = {'.github/workflows/contracts.yml',
 '.github/workflows/governance.yml',
 'apps/reference-dapp/e2e/build-ux-001.spec.ts',
 'apps/reference-dapp/e2e/canvas-ux.spec.ts',
 'apps/reference-dapp/playwright.config.ts',
 'apps/reference-dapp/src/app/page.tsx',
 'apps/reference-dapp/src/components/action-library.tsx',
 'apps/reference-dapp/src/components/app-shell.tsx',
 'apps/reference-dapp/src/components/artifact-inspector.tsx',
 'apps/reference-dapp/src/components/copilot-panel.tsx',
 'apps/reference-dapp/src/components/summary-bar.tsx',
 'apps/reference-dapp/src/components/workflow-canvas.tsx',
 'apps/reference-dapp/src/domain/canvas-actions.test.ts',
 'apps/reference-dapp/src/domain/commands.ts',
 'apps/reference-dapp/src/domain/editor.ts',
 'apps/reference-dapp/src/domain/mock-actions.ts',
 'apps/reference-dapp/src/domain/proposal.ts',
 'apps/reference-dapp/src/state/capability-store.tsx',
 'docs/AUTHORITY_MATRIX.md',
 'docs/DECISIONS.md',
 'docs/EVIDENCE_LEVELS.md',
 'docs/NEXT_BUILD.md',
 'docs/REQUIREMENTS.md',
 'docs/SCOPE_GUARD.md',
 'docs/SECURITY_MODEL.md',
 'docs/STATUS.md',
 'packages/action-registry/src/execution-capabilities.ts',
 'packages/action-registry/src/index.ts',
 'packages/reference-compiler/src/index.ts',
 'packages/reference-executor/src/index.ts',
 'packages/reference-linter/src/index.ts',
 'packages/reference-linter/src/rules.ts',
 'packages/reference-linter/src/validation.ts',
 'packages/reference-reconciler/src/index.ts',
 'packages/workflow-contracts/src/index.ts'}
REVIEWED_BYTES = {'.github/workflows/contracts.yml': '7110c5fb783e162cc9792b39d40ec128e8f554cd4562bb31162f715a5a6d53de',
 'apps/reference-dapp/e2e/build-ux-001.spec.ts': '404a02755ab3cbceef6cc6892888b67fca295d8dfcd3f202cd077f7a9258c14e',
 'apps/reference-dapp/e2e/canvas-ux.spec.ts': 'de1cf3236ecf5237739bf0503def218373129c57895e797661b07145e21c1536',
 'apps/reference-dapp/e2e/supply-fixtures.ts': '46e4ef9db6381f9f5d3385c9968d55062103e21ae6ad102bf4717cb4c20e533f',
 'apps/reference-dapp/e2e/supply-harness.mjs': '0afb7573866bf422c632d2a15d97b3a1eb60687c0a906d2ef1141f4d69c6b736',
 'apps/reference-dapp/e2e/supply-recovery.spec.ts': '3f7abefe5951f77fa209a061d84956a7f6aacadfe4fc379663b33bc648ba8f9c',
 'apps/reference-dapp/e2e/supply.spec.ts': '50f438a4438926e6d84b3700ba51c5dfcbfdd06bf15445bc0bd9ff0f60866303',
 'apps/reference-dapp/playwright.config.ts': '30d66e2ac1efbd21a982f68c2a7741a30c6415c607c931a66618295ebb88d0b3',
 'apps/reference-dapp/src/app/page.tsx': '3a2335c142e0a8d938aa5eb0f12101711efc2d2b032bd81179ab48eae0581d56',
 'apps/reference-dapp/src/app/supply-action.ts': '0251c56cf32f96cb9f015f1f5d51a6b011204c5e1436fdd56b6a860701a1bf62',
 'apps/reference-dapp/src/components/action-library.tsx': 'a1e56a1b39a6a5a3f38a407a45a9f5fe2ff637dc47ef768b9cc269af01124a51',
 'apps/reference-dapp/src/components/app-shell.tsx': 'c20d5535aa0bd83977ebb09dd4fcbaa4152bef5aca977eb030e23c553bada595',
 'apps/reference-dapp/src/components/artifact-inspector.tsx': '061747752a685c6d9ffc693cb7b64bb722e4068860c1fa37c590aeea6f19d5ba',
 'apps/reference-dapp/src/components/copilot-panel.tsx': '236f675996519a378261e64a7974bf939fcfff626e436c5b9c8ad005eaa87aa5',
 'apps/reference-dapp/src/components/summary-bar.tsx': '7467e26680ad8578d23385cb2f20c030c010c0848a2ac042f90d0f4ded2e19b9',
 'apps/reference-dapp/src/components/supply-panel.tsx': 'b0d2db78733c8432183fa0df9d78f027ef23393ec9c41b26796171adf22595a7',
 'apps/reference-dapp/src/components/workflow-canvas.tsx': '4d84435762f3107f8b694717e7d1b431b920f9f69a64da086d8751c445429382',
 'apps/reference-dapp/src/domain/canvas-actions.test.ts': '80958cb8e46653cc755b7a9b238f4d2ae504ae34987d59eb8559c5a9c2bc9599',
 'apps/reference-dapp/src/domain/commands.ts': '0239d420a7c4807ad7e995cc9f99f870de8af9f44c031d6ca08da15565ed39c6',
 'apps/reference-dapp/src/domain/editor.ts': 'ff761c7d3985e117eb8383924ca501622f1cdf6d2cfc14bb67f5595aff42fab3',
 'apps/reference-dapp/src/domain/mock-actions.ts': 'b1f1764c6026758326c758c9baebc1d44b6c3dcc9d1b0cee7a6a8ac2cbf45871',
 'apps/reference-dapp/src/domain/proposal.ts': '68da49402f33705cf4da96df03aea93cd93e36256135487ee032d3ba6418b0f3',
 'apps/reference-dapp/src/domain/supply-authoring.test.ts': 'e987d93abfd0a7eceaeee483db92e8e1a40458c043ee40e4bd036afac1b06132',
 'apps/reference-dapp/src/domain/supply-authoring.ts': 'c1e9b5d048908f7f83a3117f4ac3da87494b931fd7593a127028ae74454e975c',
 'apps/reference-dapp/src/server/supply-service.test.ts': '590ad33862f0767466764d930f653e3ef1fe341b97448dcd84f9526444c912e6',
 'apps/reference-dapp/src/server/supply-service.ts': 'ff90a34695081940b64be774497ee3e7da9f98fa608d27485888aa3515a7bf69',
 'apps/reference-dapp/src/state/capability-store.tsx': 'bf07f9ac3634446556e34abeb3c0f0fa420caf00a4b22e2c549d351c4b7ee92b',
 'apps/reference-dapp/src/state/supply-store.tsx': '8983b5743a6279ec813e43b37de4f45b17d091025b3029b6310abdafaf3dc31e',
 'packages/action-registry/src/aave-v3-testnet.ts': '3847235171611940782a5b712c10ff476a7fc845a1a519a6d48c0329ac9e4983',
 'packages/action-registry/src/execution-capabilities.ts': '144318ea7bc1889cc6d8c34848acf979fdf91cd21f5081d97e7f63c1a281fa03',
 'packages/action-registry/src/index.ts': '51348215eeff5dc6df6fceec7339feb97ab450f05d01c89c652afe5a9efbd1f9',
 'packages/action-registry/test/supply.test.ts': '17d16a81ac1fc6ebce88dc97fb355567bb3965ae328462c9c537087f6a27128a',
 'packages/reference-compiler/src/index.ts': '0dd7d4208df53e5c547b10c9342b1d3aa8fadb9f9a136a3533d82c249890b02a',
 'packages/reference-compiler/src/supply.ts': '2a57a05d8578c800e1104e14648fcaac82518ab789d99e27694b51d3850d3f7a',
 'packages/reference-compiler/test/supply.test.ts': '32dc654aebcfc7c149483bfdbe1cee8c4e198ab24fd83a26a666ac3b1e3a2ccf',
 'packages/reference-executor/src/index.ts': 'a209f063f09a9b548a6204ca584653648706d1dc27bff773cfb492d2067f91af',
 'packages/reference-executor/src/supply.ts': '039d5f50fe2270f04a6c1b1610c91a463d0c0e0d8efae6c216fb4210bf70398d',
 'packages/reference-executor/test/supply.test.ts': '02d78e22b3f7754b8ab99a3e32d41794c00d7d0d5bae3c5f383ec3d101b5ca2f',
 'packages/reference-linter/src/index.ts': 'fb5dc6e2535af82d32bc68b4826bbda420f748721be90139ae9b747211ebc8ed',
 'packages/reference-linter/src/rules.ts': 'feaf805b0463ff5b8141c4972cfbb115e66a3a0535917f8adde0497e0200b0d0',
 'packages/reference-linter/src/supply.ts': '5c413d00c5d25dbeaf6f5b7efa8d349e0613d832f0215cc6951d1346fceda1fe',
 'packages/reference-linter/src/validation.ts': 'a4ec445c04a944867a029e2a12b2f989590693504a41f287600db47bf8e9b10c',
 'packages/reference-linter/test/supply.test.ts': '09e38c8749a109b91a49d46e5eb422add9fa13b952ba97a5dc82839643bcdc53',
 'packages/reference-reconciler/src/index.ts': 'c525609e7b9daa013ef97b024c30f3142ae43460cfde096743696e21a0f174e6',
 'packages/reference-reconciler/src/supply.ts': '2db6a4d400643e3b40890e935ac251a74cc8dfe9222e7f05daa8dbe3e97c67a2',
 'packages/reference-reconciler/test/supply.test.ts': '441b4839331809de8a580b5310dbf99290eee2a99411769a61be7383d6f82fba',
 'packages/workflow-contracts/src/index.ts': '9cceea218661fffd0950eea9de96153d30e0aeb27805346c0cf2eeb03e076266',
 'packages/workflow-contracts/src/supply.ts': 'b861033063e8c42cdf65805f7ab3180db1e1f3214b6f774766e6b21ef4aff6ba',
 'packages/workflow-contracts/test/supply.test.ts': '68564eb474cde6afc31740f6a6fc8ed40266aa33b2b5d0e5092740ea0b15d361'}

READ_METHODS = {'eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call',
                'eth_getBalance','eth_getTransactionCount','eth_estimateGas','eth_gasPrice',
                'eth_getTransactionByHash','eth_getTransactionReceipt','eth_simulateV1'}
ACTION = 'apps/reference-dapp/src/app/supply-action.ts'
STORE = 'apps/reference-dapp/src/state/supply-store.tsx'
SERVICE = 'apps/reference-dapp/src/server/supply-service.ts'
SERVICE_TEST = 'apps/reference-dapp/src/server/supply-service.test.ts'
PANEL = 'apps/reference-dapp/src/components/supply-panel.tsx'
PACKAGE_SOURCES = {'packages/reference-'+name+'/src/supply.ts' for name in ('compiler','executor','reconciler')}


def reviewed_source(path, body):
    return path in REVIEWED_BYTES and hashlib.sha256(body.encode()).hexdigest() == REVIEWED_BYTES[path]


def rpc_methods(path):
    if path == ACTION or path in PACKAGE_SOURCES:
        return READ_METHODS
    if path == STORE:
        return {'eth_accounts','eth_chainId','eth_getTransactionCount','eth_sendTransaction'}
    return set()


def mask_source(path, body, category):
    """Strip only reviewed privileged tokens, then run the existing guards."""
    if not reviewed_source(path, body):
        return body
    if category == 'urls':
        if path == ACTION:
            return body.replace('http://127.0.0.1:8549', '')
        if path == PANEL:
            return body.replace('https://sepolia.basescan.org/tx/', '')
    if category == 'authority' and path in {SERVICE, SERVICE_TEST, PANEL, STORE}:
        return re.sub(r'\b(?:AuthorizationPolicy|StrategyManifest|ExecutionPlan|ExecutionJournal|JournalEntry|EvidenceBundle)\b','',body)
    if category == 'fetch' and path == ACTION:
        return body.replace('fetch(endpoint,', '', 1)
    if category == 'wallet' and path == STORE:
        return body.replace('eth_sendTransaction','')
    if category == 'storage' and path == STORE:
        return body.replace('localStorage.getItem','').replace('localStorage.setItem','')
    return body


def validate_scope(base, ref, changed, files):
    errors = []
    if base != BASE or ref != REF:
        return ['BUILD-012A requires the exact approved baseline and branch']
    mandatory = (CREATE | MODIFY) - {EVIDENCE}
    if changed - (CREATE | MODIFY):
        errors.append('BUILD-012A unapproved paths: '+', '.join(sorted(changed-(CREATE|MODIFY))))
    if mandatory - changed:
        errors.append('BUILD-012A missing implementation paths: '+', '.join(sorted(mandatory-changed)))
    for path, digest in REVIEWED_BYTES.items():
        if path not in files or hashlib.sha256(files[path]).hexdigest() != digest:
            errors.append('BUILD-012A reviewed source bytes differ: '+path)
    plan = files.get('docs/builds/BUILD-012A-PLAN.md', b'').decode()
    decisions = files.get('docs/DECISIONS.md', b'').decode()
    if BASE not in plan or 'APPROVED under DEC-0056' not in plan or REF not in plan or 'DEC-0056' not in decisions or BASE not in decisions:
        errors.append('BUILD-012A recorded owner authority missing')
    if set(re.findall(r'^\| `([^`]+)` \|', plan, re.M)) != CREATE | MODIFY:
        errors.append('BUILD-012A plan inventory differs from the approved exact scope')
    if EVIDENCE in files:
        try:
            evidence = json.loads(files[EVIDENCE])
            bundle = evidence['bundle']
            public = evidence['publicExecution']
            if (bundle['environment'] != 'TESTNET_EXECUTED' or bundle['outcome'] != 'RECONCILED'
                    or public['chainId'] != 84532 or public['network'] != 'Base Sepolia'
                    or public['pool'].lower() != '0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27'
                    or not re.fullmatch(r'0x[0-9a-f]{64}', public['supplyTransactionHash'])):
                raise ValueError('not reconciled public acceptance')
        except (ValueError, KeyError, TypeError):
            errors.append('BUILD-012A acceptance evidence must be reconciled real public execution')
    return errors
