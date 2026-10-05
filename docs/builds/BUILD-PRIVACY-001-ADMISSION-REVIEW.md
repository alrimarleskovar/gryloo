# BUILD-PRIVACY-001 — concrete dependency admission review

This is a technical review packet, **not approval or an audit/license exception**. Financial admission remains false. No dependency, lockfile, verifier, CI file or license allowlist was changed.

## Authenticated graph delta

Baseline commit: `64deb1699ffd06b69cd168e963897a8c613ab771`. The baseline resolved-section hash matches the unchanged verifier: `7477e3d4b87bd36605580e7e0032fc0bd2801f59ea251669d2e361d93684bdd9`.

Current lockfile SHA-256: `183f41fce7495413d6d2b990f6f947b110d1d777ed144c37dbe6800d777e1760`. Exact graph: **262 baseline identities + 149 Privacy additions = 411**. No baseline identity was removed, and no baseline package SRI changed. Every addition is reachable through the pinned Cloak SDK or prover. All 149 official registry SRIs and minimum seven-day release ages verified.

Local candidate: `.turbo/privacy-admission-review/candidate.json`; SHA-256 `7e75b6d8a9540e522d64359b8afd883c34e7e33e4e556598b297d5eb2f928fc7`. Its `admitted` field is false. Registry/archive/source inspection evidence stays ephemeral, separately from encrypted owner vault data.

## Advisory boundary

Fresh pinned-pnpm audit still fails on one low Elliptic advisory and zero moderate/high/critical findings. [The official advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84) lists no patched version. Official registry metadata still reports latest Elliptic 6.6.1 and no published 6.6.2. Cloak stable 0.2.5 and staging 0.2.6-staging.6c85601 both depend on circomlibjs 0.1.7, whose Ethers 5 chain reaches @ethersproject/signing-key 5.8.0 with exact elliptic 6.6.1.

No compatible published upgrade was found. Raising severity thresholds, ignoring the advisory, spoofing a version or replacing signing cryptography would not clear this gate safely. A genuinely patched compatible published dependency/provider release is still required under the current rules.

## Archive-based legal evidence

Every archive below was independently SHA-512 matched to its exact lockfile SRI before legal-file inspection. Esprima has a verified two-clause BSD legal file despite missing modern registry metadata. The two TweetNaCl archives contain identical Unlicense text. GPL metadata was not silently converted into an allowed license.

| Identity | Registry license | Packaged legal evidence |
| --- | --- | --- |
| `@cloak.dev/sdk@0.2.5` | Apache-2.0 | `package/LICENSE` SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `@iden3/bigarray@0.0.2` | GPL-3.0 | **No packaged legal file or source grant header found; metadata alone was not admitted** |
| `@iden3/binfileutils@0.0.12` | GPL-3.0 | **No packaged legal file or source grant header found; metadata alone was not admitted** |
| `circomlibjs@0.1.7` | GPL-3.0 | **No packaged legal file or source grant header found; metadata alone was not admitted** |
| `esprima@1.2.5` | missing | `package/LICENSE.BSD` SHA-256 `0e74697a68cebdcd61502c30fe80ab7f9e341d995dcd452023654d57133534b1` |
| `fastfile@0.0.20` | GPL-3.0 | `package/COPYING` SHA-256 `d95c74a62d14f13ebfbc8c1783c315e2ed2389e80048b264bdeddb8114dee945` |
| `ffjavascript@0.2.63` | GPL-3.0 | `package/COPYING` SHA-256 `d95c74a62d14f13ebfbc8c1783c315e2ed2389e80048b264bdeddb8114dee945` |
| `ffjavascript@0.3.0` | GPL-3.0 | `package/COPYING` SHA-256 `d95c74a62d14f13ebfbc8c1783c315e2ed2389e80048b264bdeddb8114dee945` |
| `ffjavascript@0.3.1` | GPL-3.0 | `package/COPYING` SHA-256 `d95c74a62d14f13ebfbc8c1783c315e2ed2389e80048b264bdeddb8114dee945` |
| `r1csfile@0.0.48` | GPL-3.0 | `package/COPYING` SHA-256 `589ed823e9a84c56feb95ac58e7cf384626b9cbf4fda2a907bc36e103de1bad2` |
| `snarkjs@0.7.6` | GPL-3.0 | `package/COPYING` SHA-256 `d95c74a62d14f13ebfbc8c1783c315e2ed2389e80048b264bdeddb8114dee945` |
| `tweetnacl-util@0.15.1` | Unlicense | `package/LICENSE` SHA-256 `88d9b4eb60579c191ec391ca04c16130572d7eedc4a86daa58bf28c6e14c9bcd` |
| `tweetnacl@1.0.3` | Unlicense | `package/LICENSE` SHA-256 `88d9b4eb60579c191ec391ca04c16130572d7eedc4a86daa58bf28c6e14c9bcd` |
| `wasmbuilder@0.0.16` | GPL-3.0 | `package/COPYING` SHA-256 `589ed823e9a84c56feb95ac58e7cf384626b9cbf4fda2a907bc36e103de1bad2` |
| `wasmcurves@0.2.2` | GPL-3.0 | `package/COPYING` SHA-256 `d95c74a62d14f13ebfbc8c1783c315e2ed2389e80048b264bdeddb8114dee945` |

The application is AGPL-3.0-only. AGPL section 13 and GPL section 13 permit the stated GPLv3/AGPLv3 combination while retaining each component’s terms; this does not erase notices or corresponding-source obligations. The repository already retains the official AGPL text. A release/admission review still must preserve package attribution and legal texts, establish corresponding-source availability for the actual distributed combination and record exact identity/SRI/route/platform/optional-status decisions. The SDK itself declares Apache-2.0 and its packaged LICENSE agrees; no SDK license discrepancy was found.

The SRI-verified archives for @iden3/bigarray 0.0.2, @iden3/binfileutils 0.0.12 and circomlibjs 0.1.7 omit standalone legal files and grant headers. Their registry metadata declares GPL-3.0. Exact registry gitHead references identified for further source/legal provenance: `9e7cd76c2a19691d196af834df279aaf8b6d0acd`, `7bba9c3af63c9d107364f125902c75644e68cc15`, and `4f094c5be05c1f0210924a3ab204d8fd8da69f49`, respectively. No copyright or license text was invented to fill those gaps.

## What remains required

The unchanged verifier still reports 21 findings. The graph delta is now characterized and archive evidence is collected; it has not been admitted. Remaining work is exact reviewed SDK/prover direct-pin and graph admission, the 14 license findings with complete notices/source obligations, and a compatible fix for Elliptic. A generated SBOM or registry metadata success is not a substitute for these decisions. No owner funds, wallet signature, secret or API key can resolve these dependency findings.

## Exact added identities, registry declarations and package SRIs

Each row is investigation evidence. The complete local candidate additionally records the deterministic provider/prover route, publication time, platform restrictions and optional status.

| Identity | Registry license | SRI |
| --- | --- | --- |
| `@cloak.dev/sdk@0.2.5` | Apache-2.0 | `sha512-D2gwVEBpnPX23sxUuMQHefXO03s+euajiXKJpQkTx+RI5dTvJXFbnwA3UqYZ+lLwToHvBqjYGqPwjDsCUCdoyw==` |
| `@ethersproject/abi@5.8.0` | MIT | `sha512-b9YS/43ObplgyV6SlyQsG53/vkSal0MNA1fskSC4mbnCMi8R+NkcH8K9FPYNESf6jUefBUniE4SOKms0E/KK1Q==` |
| `@ethersproject/abstract-provider@5.8.0` | MIT | `sha512-wC9SFcmh4UK0oKuLJQItoQdzS/qZ51EJegK6EmAWlh+OptpQ/npECOR3QqECd8iGHC0RJb4WKbVdSfif4ammrg==` |
| `@ethersproject/abstract-signer@5.8.0` | MIT | `sha512-N0XhZTswXcmIZQdYtUnd79VJzvEwXQw6PK0dTl9VoYrEBxxCPXqS0Eod7q5TNKRxe1/5WUMuR0u0nqTF/avdCA==` |
| `@ethersproject/address@5.8.0` | MIT | `sha512-GhH/abcC46LJwshoN+uBNoKVFPxUuZm6dA257z0vZkKmU1+t8xTn8oK7B9qrj8W2rFRMch4gbJl6PmVxjxBEBA==` |
| `@ethersproject/base64@5.8.0` | MIT | `sha512-lN0oIwfkYj9LbPx4xEkie6rAMJtySbpOAFXSDVQaBnAzYfB4X2Qr+FXJGxMoc3Bxp2Sm8OwvzMrywxyw0gLjIQ==` |
| `@ethersproject/basex@5.8.0` | MIT | `sha512-PIgTszMlDRmNwW9nhS6iqtVfdTAKosA7llYXNmGPw4YAI1PUyMv28988wAb41/gHF/WqGdoLv0erHaRcHRKW2Q==` |
| `@ethersproject/bignumber@5.8.0` | MIT | `sha512-ZyaT24bHaSeJon2tGPKIiHszWjD/54Sz8t57Toch475lCLljC6MgPmxk7Gtzz+ddNN5LuHea9qhAe0x3D+uYPA==` |
| `@ethersproject/bytes@5.8.0` | MIT | `sha512-vTkeohgJVCPVHu5c25XWaWQOZ4v+DkGoC42/TS2ond+PARCxTJvgTFUNDZovyQ/uAQ4EcpqqowKydcdmRKjg7A==` |
| `@ethersproject/constants@5.8.0` | MIT | `sha512-wigX4lrf5Vu+axVTIvNsuL6YrV4O5AXl5ubcURKMEME5TnWBouUh0CDTWxZ2GpnRn1kcCgE7l8O5+VbV9QTTcg==` |
| `@ethersproject/contracts@5.8.0` | MIT | `sha512-0eFjGz9GtuAi6MZwhb4uvUM216F38xiuR0yYCjKJpNfSEy4HUM8hvqqBj9Jmm0IUz8l0xKEhWwLIhPgxNY0yvQ==` |
| `@ethersproject/hash@5.8.0` | MIT | `sha512-ac/lBcTbEWW/VGJij0CNSw/wPcw9bSRgCB0AIBz8CvED/jfvDoV9hsIIiWfvWmFEi8RcXtlNwp2jv6ozWOsooA==` |
| `@ethersproject/hdnode@5.8.0` | MIT | `sha512-4bK1VF6E83/3/Im0ERnnUeWOY3P1BZml4ZD3wcH8Ys0/d1h1xaFt6Zc+Dh9zXf9TapGro0T4wvO71UTCp3/uoA==` |
| `@ethersproject/json-wallets@5.8.0` | MIT | `sha512-HxblNck8FVUtNxS3VTEYJAcwiKYsBIF77W15HufqlBF9gGfhmYOJtYZp8fSDZtn9y5EaXTE87zDwzxRoTFk11w==` |
| `@ethersproject/keccak256@5.8.0` | MIT | `sha512-A1pkKLZSz8pDaQ1ftutZoaN46I6+jvuqugx5KYNeQOPqq+JZ0Txm7dlWesCHB5cndJSu5vP2VKptKf7cksERng==` |
| `@ethersproject/logger@5.8.0` | MIT | `sha512-Qe6knGmY+zPPWTC+wQrpitodgBfH7XoceCGL5bJVejmH+yCS3R8jJm8iiWuvWbG76RUmyEG53oqv6GMVWqunjA==` |
| `@ethersproject/networks@5.8.0` | MIT | `sha512-egPJh3aPVAzbHwq8DD7Po53J4OUSsA1MjQp8Vf/OZPav5rlmWUaFLiq8cvQiGK0Z5K6LYzm29+VA/p4RL1FzNg==` |
| `@ethersproject/pbkdf2@5.8.0` | MIT | `sha512-wuHiv97BrzCmfEaPbUFpMjlVg/IDkZThp9Ri88BpjRleg4iePJaj2SW8AIyE8cXn5V1tuAaMj6lzvsGJkGWskg==` |
| `@ethersproject/properties@5.8.0` | MIT | `sha512-PYuiEoQ+FMaZZNGrStmN7+lWjlsoufGIHdww7454FIaGdbe/p5rnaCXTr5MtBYl3NkeoVhHZuyzChPeGeKIpQw==` |
| `@ethersproject/providers@5.8.0` | MIT | `sha512-3Il3oTzEx3o6kzcg9ZzbE+oCZYyY+3Zh83sKkn4s1DZfTUjIegHnN2Cm0kbn9YFy45FDVcuCLLONhU7ny0SsCw==` |
| `@ethersproject/random@5.8.0` | MIT | `sha512-E4I5TDl7SVqyg4/kkA/qTfuLWAQGXmSOgYyO01So8hLfwgKvYK5snIlzxJMk72IFdG/7oh8yuSqY2KX7MMwg+A==` |
| `@ethersproject/rlp@5.8.0` | MIT | `sha512-LqZgAznqDbiEunaUvykH2JAoXTT9NV0Atqk8rQN9nx9SEgThA/WMx5DnW8a9FOufo//6FZOCHZ+XiClzgbqV9Q==` |
| `@ethersproject/sha2@5.8.0` | MIT | `sha512-dDOUrXr9wF/YFltgTBYS0tKslPEKr6AekjqDW2dbn1L1xmjGR+9GiKu4ajxovnrDbwxAKdHjW8jNcwfz8PAz4A==` |
| `@ethersproject/signing-key@5.8.0` | MIT | `sha512-LrPW2ZxoigFi6U6aVkFN/fa9Yx/+4AtIUe4/HACTvKJdhm0eeb107EVCIQcrLZkxaSIgc/eCrX8Q1GtbH+9n3w==` |
| `@ethersproject/solidity@5.8.0` | MIT | `sha512-4CxFeCgmIWamOHwYN9d+QWGxye9qQLilpgTU0XhYs1OahkclF+ewO+3V1U0mvpiuQxm5EHHmv8f7ClVII8EHsA==` |
| `@ethersproject/strings@5.8.0` | MIT | `sha512-qWEAk0MAvl0LszjdfnZ2uC8xbR2wdv4cDabyHiBh3Cldq/T8dPH3V4BbBsAYJUeonwD+8afVXld274Ls+Y1xXg==` |
| `@ethersproject/transactions@5.8.0` | MIT | `sha512-UglxSDjByHG0TuU17bDfCemZ3AnKO2vYrL5/2n2oXvKzvb7Cz+W9gOWXKARjp2URVwcWlQlPOEQyAviKwT4AHg==` |
| `@ethersproject/units@5.8.0` | MIT | `sha512-lxq0CAnc5kMGIiWW4Mr041VT8IhNM+Pn5T3haO74XZWFulk7wH1Gv64HqE96hT4a7iiNMdOCFEBgaxWuk8ETKQ==` |
| `@ethersproject/wallet@5.8.0` | MIT | `sha512-G+jnzmgg6UxurVKRKvw27h0kvG75YKXZKdlLYmAHeF32TGUzHkOFd7Zn6QHOTYRFWnfjtSSFjBowKo7vfrXzPA==` |
| `@ethersproject/web@5.8.0` | MIT | `sha512-j7+Ksi/9KfGviws6Qtf9Q7KCqRhpwrYKQPs+JBA/rKVFF/yaWLHJEH3zfVP2plVu+eys0d2DlFmhoQJayFewcw==` |
| `@ethersproject/wordlists@5.8.0` | MIT | `sha512-2df9bbXicZws2Sb5S6ET493uJ0Z84Fjr3pC4tu/qlnZERibZCeUVuqdtt+7Tv9xxhUxHoIekIA7avrKUWHrezg==` |
| `@iden3/bigarray@0.0.2` | GPL-3.0 | `sha512-Xzdyxqm1bOFF6pdIsiHLLl3HkSLjbhqJHVyqaTxXt3RqXBEnmsUmEW47H7VOi/ak7TdkRpNkxjyK5Zbkm+y52g==` |
| `@iden3/binfileutils@0.0.12` | GPL-3.0 | `sha512-naAmzuDufRIcoNfQ1d99d7hGHufLA3wZSibtr4dMe6ZeiOPV1KwOZWTJ1YVz4HbaWlpDuzVU72dS4ATQS4PXBQ==` |
| `@jup-ag/api@6.0.48` | MIT | `sha512-H66m/cIqdVIA0qLI2X76UOhuMXkS/+uI6e4KQuU3fn6FSBhCX/9fwt/4IdwES4KWXwGtvqhsg2ExkB9tRtNhyA==` |
| `@lightprotocol/hasher.rs@0.2.1` | ISC | `sha512-uslXM+t8kIOeQKccS8eJIPhVglnaIrz06AUVYJjeR9RHM/26KFEKK431a5mBxvaAwVhRLM0s9ZFN+C9wKgNAjA==` |
| `@noble/hashes@1.8.0` | MIT | `sha512-jCs9ldd7NwzpgXDIf6P3+NrHh9/sD6CQdxHyjQI+h/6rDNo88ypBxxz45UDuZHz9r3tNz7N/VInSVoVdtXEI4A==` |
| `@solana-program/address-lookup-table@0.14.1` | Apache-2.0 | `sha512-bYhSDq3lKB/kOIyx5jd91DwyDZH3GeBTpZaIO2YQC0ivFepPK4TWNwqFvdRfZ5wm5/70sp9Fs3lQeewUqVhXHA==` |
| `@solana-program/compute-budget@0.18.1` | Apache-2.0 | `sha512-ZVWknu3XvF6NI3zAuT6TXV19lQ7iDPzToM9gwI6KnUlnzHHP3u7IAIzDM7hLueQ6T7vLGjIUjYFCVg4mLHRZcg==` |
| `@solana-program/memo@0.13.1` | Apache-2.0 | `sha512-c0J4nNSTbGjRlVfn81mavBQvBy22Gad6cKSJw+x2pqBtNiBLL60W+wWuxhHfQeb+v1nETvtupgIrDrrWrlqXcw==` |
| `@solana-program/system@0.14.1` | Apache-2.0 | `sha512-K6ZiIrAKoJAfcwfUdsoFvfSAxeRJaRrV7BPFTJvUVRS4m3zszN+nLcdaNMMe2F1/zTriZqC+xh+Kgw6ziGUqpQ==` |
| `@solana-program/token@0.16.1` | Apache-2.0 | `sha512-X9dsvbh+VDq4SuCfvxn95P1DCvtBYHJOBiVmgBJMfW8l/lp8uSwEhy9IurpcdltnGi5kNIkCm4sk4YOXKAMiCw==` |
| `@solana/accounts@8.3.0` | MIT | `sha512-HNVCs4yyE5kTRHVD3ApuKuByuO85GHE6Ns7I/yMB9vXhFgZjGzFhOGi/YCjlWpIk3RqTyX7wGniHyEb49R3ELQ==` |
| `@solana/addresses@8.3.0` | MIT | `sha512-HSAPbu5TpHYZqUo9SBALvDeOyfU1Cdtk9PCmxv+YjclNuDVbh+yMnesZ614zjhKJ8clvyidWSgmISjlFCJv6qA==` |
| `@solana/assertions@8.3.0` | MIT | `sha512-6NI79X6VANpq1b1BAnQevCs63dW4l3XKSbikVd5k8mlIsURlCTFdtrbXfQInqsUWZJWElf7ZLQu7RkbBOj6wuw==` |
| `@solana/codecs-core@8.3.0` | MIT | `sha512-rpt01CPeF4FhTTJHyr0Tr4n8U1shYPhe7q2mcmTYyKPATYAkyb5CLHnYKnN6LO71EZSFq3Y2Wm27rwWcBvAJzg==` |
| `@solana/codecs-data-structures@8.3.0` | MIT | `sha512-ojwHBnDia6VtkoCzppJGXJ1JZkQ4teYToTRu0e4N5dEkZlFU5EmpeX+1xsw7gu4bR9cNXXMWbWw4uFgVM8Nd6Q==` |
| `@solana/codecs-numbers@8.3.0` | MIT | `sha512-12u+Y9ERE+gqraV1g0BP/5QxbamukFub05kyj3d3s6V/26ZEby6ReHJ8yuKtPl9fIUnfoQ2M4+th/7u5+5v14w==` |
| `@solana/codecs-strings@8.3.0` | MIT | `sha512-S7rZrc1B90AS0QVRlo6+6cX2t+0TGtsadsPWdfA7tXcaDKQfQn4C/6OJxJ7/n8ugw8LMgGC+Xcs81ii4nIp6aQ==` |
| `@solana/codecs@8.3.0` | MIT | `sha512-BtiHdl7pDw6tadQAn3Vi1s0wgp0BGQ3ndTQRBtxuwmyCzlGfyuvMBq+ynkuGWwknvOpU2eTNEO84U/b7wqLB7w==` |
| `@solana/compat@8.3.0` | MIT | `sha512-3TJ/UsOoHOheg5BrYwiGz5/dlXnOCPSql3h8s+c6L4dOGGuqGnXdd5JH69sQSpNElw91Ui5gdvtFp5B36QGHTQ==` |
| `@solana/errors@8.3.0` | MIT | `sha512-XsoQ5ThBOwfMz1KS7I2zZoduLxUYFe+NHuRAm/gt+uk44nnXqwzNJHo/9GEMqJqxafViqvfRZ35GF1fDkwW32Q==` |
| `@solana/fast-stable-stringify@8.3.0` | MIT | `sha512-QVVSFQPLJaFeUFekWHe04TUr5rL2QbgPCEK0HcmlOLgCWTvduwj1D9e73jjYzL5HU1QRyUfzkw+GnSw95nvjLg==` |
| `@solana/fixed-points@8.3.0` | MIT | `sha512-cah+OuTSXqSMRlTQdj3sQmf7RK1m2RG50RzSgLFWeAAl+WCsoR4pyGPFxhQMw9JdaniqOUkKKB3ppxTMgfoHEg==` |
| `@solana/functional@8.3.0` | MIT | `sha512-HBtC8tA8q73JQYHFaNROGiBLcwPcbQHldN7f1NqCgYY9x/iIt/zvWPeoxiRkncYCE9MwDLyWMq3LnetjqOifOA==` |
| `@solana/instruction-plans@8.3.0` | MIT | `sha512-ltuS+fTWsNQokFxK8StQzn/ZDkrR/P4Pao5EpQxYHPQQ+Z83g61kWFEnR+bB9WBDUZwu2CJptNXItKSgGOWwmg==` |
| `@solana/instructions@8.3.0` | MIT | `sha512-piAAqqC5NEvN2Mf2FP6PWogl8qCVg/2cEt+LKyq89P0sNbaeMPK11wGcZR6e3LEBMBSnjAw4DbDerDWg6GC0eg==` |
| `@solana/keys@8.3.0` | MIT | `sha512-Fs8rtmxliPlDu/6iJniU4FfvUfD63OSxIAbMv2CyNvK9fg7dmQ9fUEBuK3WpwAlpKwhEHCzaFSWNUaB2SmeviQ==` |
| `@solana/kit@8.3.0` | MIT | `sha512-2T2QaO+0/CeZnPMsjv/bGhBSEiBCMY6V/Qi0xhFF/+8yCH8tkzM/kgE7fX5JlrR3gZpl9Bu+C62KTqnvk/bcjw==` |
| `@solana/nominal-types@8.3.0` | MIT | `sha512-x2aCcMwe6C2tQNq4pAhx4bEd2zhrm3i7DjkdAJAPVCtPKd6ecO6iaV+53/RvE2ImZ0E9aVB41lPV8ZM0dMhRiw==` |
| `@solana/offchain-messages@8.3.0` | MIT | `sha512-zpwwQRTX+aBF97fgZW+T+grZWqKbCMa6moDnYHsCkQg67nCeb9OrPtZxMbCT5bP+kDgMTq2URQwS1NcZOwut+Q==` |
| `@solana/options@8.3.0` | MIT | `sha512-+mi+EvxdjlOxt3dv7wTfzGxVFw0j8flZ8gGSXCx969JrML9EZd3+wgsKuMNb3whbvGa/N5exPZXfzsG+wNlK8A==` |
| `@solana/plugin-core@8.3.0` | MIT | `sha512-cU5S9QR7C1Xsn9DDRSLN7Vq8+kWy6Fw6g2lwa+9yZqdSqABhmdH5HBJG/Zl8HULz2Ady0y8qHcu8fEZsehuU0g==` |
| `@solana/plugin-interfaces@8.3.0` | MIT | `sha512-EawuCQiW5A13qdArRODYbAsAvi9fRkORk1hq14kbRAR0A/7XwQLniAWrgKY4WZ1UXuECB/LxKc8uQwfH5u1JOw==` |
| `@solana/program-client-core@8.3.0` | MIT | `sha512-GUFVAFaEgVvznI6mrfa69I0SVnO5mD5RpYKdSEHvGnIMzupgjZhTcmhSxMIU06hFA2ZLF+NbKsOKMQFVicOCjw==` |
| `@solana/programs@8.3.0` | MIT | `sha512-XosDh9GNaDUCvzpFE2e3M7iQ6tounwrhR16+KInjYNcvQDLgA5yeCbNfByai7OSz9iqEi5nlXjQFIQCckLANVw==` |
| `@solana/promises@8.3.0` | MIT | `sha512-RekTh1UzvyD1EtF4hjenJDrnpGakJwTCE7cq6auQKtBxQUIJrKwDxmpyiJTJ00wvQYdMfMuyJEPQNuxgm6mxrg==` |
| `@solana/rpc-api@8.3.0` | MIT | `sha512-8wvVbQLbp8Mjd0Vcg2IZqkNreSGkgOPe4IhCrO2GqJQyTNAI8Ir6o/Qt3zIj02IQS9LDL9rZPvynL+1PFPSlOA==` |
| `@solana/rpc-parsed-types@8.3.0` | MIT | `sha512-cK0Yu7I8HADKYQdlyIuCFd2sq1sCrIm7q0H9nqeS7b5ILLYoH9T3AnCZ437N7Z4jZBekL2DGdpdE2M84F0fphQ==` |
| `@solana/rpc-spec-types@8.3.0` | MIT | `sha512-D757241XGKwmBRlQ1xSGknBqRaXq8ZO0BDl5UupG0UyHsfdk6iKDrJFccaNx1m2LKExzlu8iWZTEdnrueDDL7A==` |
| `@solana/rpc-spec@8.3.0` | MIT | `sha512-HWMQsAUsW8LOkojFopkkkTSIFAFeYDA6B4NiXtXZ8q5qKRKDB+qCVTC1un8RorKrnayLM7gF73Oi5gPD2ANL/w==` |
| `@solana/rpc-subscriptions-api@8.3.0` | MIT | `sha512-NHjPuylayZHuBNXPkMT0sMHGUKAenck+P9Iep1ZzfH0py9SJcKOU8LHecSdGl7GjHk0SCs+iCBew+89JYrcTaA==` |
| `@solana/rpc-subscriptions-channel-websocket@8.3.0` | MIT | `sha512-4Ix52idqRT3q0Ty5sr9lUj/S8Flf+/8q7NMuAxYNH827C71AO6vVpkpAY1YpU53MKnKy0Tox0mLLScocftgEJQ==` |
| `@solana/rpc-subscriptions-spec@8.3.0` | MIT | `sha512-iv6f4N7Pva3KGljkT4kEBsMDjWVHShtysuPOko8doLBSKuelOj+b+79iYpezeu6hpbZ0YxBvlmJkOtUyeIhRJA==` |
| `@solana/rpc-subscriptions@8.3.0` | MIT | `sha512-/oI9aXKOTFnIoZ+wmvZeNfSu5h8Vl90a4W6U/K8OZE2AKjK1dbKI4bR1k7P/3SORY9Z0AN2S9UsohQ6Z6n9jKA==` |
| `@solana/rpc-transformers@8.3.0` | MIT | `sha512-eDn1PwS+MbMAJN4ZSWzMYGt0jEwvyaZJwDeQdOdWYEkqKJKlLsO1AAxLmz3LW3R/iKyWa4KwjrJ5Ia9oAugS6g==` |
| `@solana/rpc-transport-http@8.3.0` | MIT | `sha512-XD3Bo5KZekQhrReoF6UzFW66NUYqa4Rg1wBjFEIsC/sABhLJ+062O1GPS3HY9AcxZBW48rAmfNe1Qqkerxajzw==` |
| `@solana/rpc-types@8.3.0` | MIT | `sha512-T8DlDU5hu/pspKNWriwkJHXqzb7B6EQVVC6sgciZp78VB9R413+K6QhC7jZc96mNcoaATKRRg2tDDyiezKZVIg==` |
| `@solana/rpc@8.3.0` | MIT | `sha512-giS/v09dby/VD77uDfNrhr5fLi5K5NIOp3jIFfKpdAnfPHgKLv050xdmL9ZltrWucrGuePinzUTLWkdkf4s/cw==` |
| `@solana/signers@8.3.0` | MIT | `sha512-uNiJZV6npLBQ0jYsK5fmtemZ0igQ4HW9QR9t5qSxbxRa52yZjzX7zkSpFhQJsxvBCAUR2ppVmhanDeupPXf4Mw==` |
| `@solana/subscribable@8.3.0` | MIT | `sha512-tLoGNOt19oUTxIoOaBxQRNxKJET/IXBx1NZkGD1lh4X8iNc6V0lY3MMIWjNvRivFIpzeWtWYxX/tAb27xpmcXg==` |
| `@solana/sysvars@8.3.0` | MIT | `sha512-SXnKqpV4pj3vLvcyBn8+jeVouu4Bbk0PTmHMknsig6edWcpmvAXkufcRdxgVy5t58pdSf1+GlJGEEhP5NR/0xA==` |
| `@solana/transaction-confirmation@8.3.0` | MIT | `sha512-xx4sO4+0nP84SvxPPmHFKkUyBEQDFC2Vn8eqV8qEG3yo0ruHlZ45g0IeYhz9WS20WPgkXvGB5bVU8Y3yv/4vPw==` |
| `@solana/transaction-introspection@8.3.0` | MIT | `sha512-uuPNYLhgueMG1ZxWH+SqPHiyz7KM0vFUDPCVRQUVTTWFryWDeu6GExfy+mFMPRR25cp+hWYmYhddub8BU2sPXQ==` |
| `@solana/transaction-messages@8.3.0` | MIT | `sha512-AkgHRPOnwonB7n81rTwnZ9WFlagnhzDzXKGhETdffzC+A1GifXC2s/ou0/qNozuqlgPVDaBR02S/A3Vt1tYr/g==` |
| `@solana/transactions@8.3.0` | MIT | `sha512-zNCHu2W3t6r4W3rsCA5vZ93bGqcZPNgfgYjTamRC6xTZPP2qn5JR+bSR9/WBMpi8GwLzWYuDk6YtNp3+pYGKuQ==` |
| `aes-js@3.0.0` | MIT | `sha512-H7wUZRn8WpTq9jocdxQ2c8x2sKo9ZVmzfRE13GiNJXfp7NcKYEdvl3vspKjXox6RIG2VtaRe4JFvxG4rqp2Zuw==` |
| `async@3.2.6` | MIT | `sha512-htCUDlxyyCLMgaM3xXg0C0LW2xqfuQ6p05pCEIsXuyQ+a1koYKTuBMzRNwmybfLgvJDMd0r1LTn4+E0Ti6C2AA==` |
| `b4a@1.9.0` | Apache-2.0 | `sha512-dpfcF9fDNR6++cthXR67iyhgqWy9CBouAvIWhIntzBG6cvK/cnIPiZQjBwi/ZqjjBEDGfoNDtmB0kTjroOJ3pQ==` |
| `balanced-match@1.0.2` | MIT | `sha512-3oSeUO0TMV67hN1AmbXsK4yaqU7tjiHlbxRDZOpH0KW9+CeX4bRAaX0Anxt0tx2MrpRpWwQaPwIlISEJhYU5Pw==` |
| `base-x@5.0.1` | MIT | `sha512-M7uio8Zt++eg3jPj+rHMfCC+IuygQHHCOU+IYsVtik6FWjuYpVt/+MRKcgsAMHh8mMFAwnB+Bs+mTrFiXjMzKg==` |
| `bech32@1.1.4` | MIT | `sha512-s0IrSOzLlbvX7yp4WBfPITzpAU8sqQcpsmwXDiKwrG4r491vwCO/XpejasRNl0piBMe/DvP4Tz0mIS/X1DPJBQ==` |
| `bfj@7.1.0` | MIT | `sha512-I6MMLkn+anzNdCUp9hMRyui1HaNEUCco50lxbvNS4+EyXg8lN3nJ48PjPWtbH8UVS9CuMoaKE9U2V3l29DaRQw==` |
| `blake-hash@2.0.0` | MIT | `sha512-Igj8YowDu1PRkRsxZA7NVkdFNxH5rKv5cpLxQ0CVXSIA77pVYwCPRQJ2sMew/oneUpfuYRyjG6r8SmmmnbZb1w==` |
| `blake2b-wasm@2.4.0` | MIT | `sha512-S1kwmW2ZhZFFFOghcx73+ZajEfKBqhP82JMssxtLVMxlaPea1p9uoLiUZ5WYyHn0KddwbLc+0vh4wR0KBNoT5w==` |
| `blake2b@2.1.4` | ISC | `sha512-AyBuuJNI64gIvwx13qiICz6H6hpmjvYS5DGkG6jbXMOT8Z3WUJ3V1X0FlhIoT1b/5JtHE3ki+xjtMvu1nn+t9A==` |
| `bluebird@3.7.2` | MIT | `sha512-XpNj6GDQzdfW+r2Wnn7xiSAd7TM3jzkxGXBGTtWKuSXv1xUV+azxAm8jdWZN06QTQk+2N2XB9jRDkvbmQmcRtg==` |
| `bn.js@4.12.5` | MIT | `sha512-3aRg6/JxfffFD+OlOjOFR3Vo79l39ooBTFucxx+MT3dhCtzn3EmiUPQo+6/OZuI2jbXi3YKgmiTFBgChQMwIRQ==` |
| `bn.js@5.2.5` | MIT | `sha512-Vq886eXykuP5E6HcKSSStP3bJgrE6In5WKxVUvJ8XGpWWYs2xZHWqUwzCtGgEtBcxyd57KBFDPFoUfNzdaHCNg==` |
| `brace-expansion@2.1.7` | MIT | `sha512-uZbew1NqdmPDTMJ8ah1y+b+9QEJrfkXFk3RcTQw3X0jW/xRUvFKsg1CfQdSYGdTbXZWExtU3J3ccxtnfw1Fi0g==` |
| `brorand@1.1.0` | MIT | `sha512-cKV8tMCEpQs4hK/ik71d6LrPOnpkpGBR0wzxqr68g2m/LB2GxVYQroAjMJZRVM1Y4BCjCKc3vAamxSzOY2RP+w==` |
| `bs58@6.0.0` | MIT | `sha512-PD0wEnEYg6ijszw/u8s+iI3H17cTymlrwkKhDhPZq+Sokl3AU4htyBFTjAeNAlCCmg0f53g6ih3jATyCKftTfw==` |
| `chalk@5.6.2` | MIT | `sha512-7NzBL0rN6fMUW+f7A6Io4h40qQlG+xGmtMxfbnH/K7TAtt8JQWVQK+6g0UXKMeVJoyV5EkkNsErQ8pVD3bLHbA==` |
| `check-types@11.2.3` | MIT | `sha512-+67P1GkJRaxQD6PKK0Et9DhwQB+vGg3PM5+aavopCpZT1lj9jeqfvpgTLAWErNj8qApkkmXlu/Ug74kmhagkXg==` |
| `circom_runtime@0.1.28` | Apache-2.0 | `sha512-ACagpQ7zBRLKDl5xRZ4KpmYIcZDUjOiNRuxvXLqhnnlLSVY1Dbvh73TI853nqoR0oEbihtWmMSjgc5f+pXf/jQ==` |
| `circomlibjs@0.1.7` | GPL-3.0 | `sha512-GRAUoAlKAsiiTa+PA725G9RmEmJJRc8tRFxw/zKktUxlQISGznT4hH4ESvW8FNTsrGg/nNd06sGP/Wlx0LUHVg==` |
| `commander@15.0.0` | MIT | `sha512-z67u4ZhzCL/Tydu1lJARtEZYWbWaN7oYLHbsuzocr6y4N6WZAagG3RQ4FW61V1/0+jImpj293XfrcYnd1qxtPg==` |
| `ejs@3.1.10` | Apache-2.0 | `sha512-UeJmFfOrAQS8OJWPZ4qtgHyWExa088/MtK5UEyoJGFH67cDEXkZSviOiKRCZ4Xij0zxI3JECgYs3oKx+AizQBA==` |
| `elliptic@6.6.1` | MIT | `sha512-RaddvvMatK2LJHqFJ+YA4WysVN5Ita9E35botqIYspQ4TkRAlCicdzKOjlyv/1Za5RyTNn7di//eEV0uTAfe3g==` |
| `escodegen@2.1.0` | BSD-2-Clause | `sha512-2NlIDTwUWJN0mRPQOdtQBzbUHvdGY2P1VXSyU83Q3xKxM7WHX2Ql8dKq782Q9TgQUNOLEzEYu9bzLNj1q88I5w==` |
| `esprima@1.2.5` | missing | `sha512-S9VbPDU0adFErpDai3qDkjq8+G05ONtKzcyNrPKg/ZKa+tf879nX2KexNU95b31UoTJjRLInNBHHHjFPoCd7lQ==` |
| `esprima@4.0.1` | BSD-2-Clause | `sha512-eGuFFw7Upda+g4p+QHvnW0RyTX/SVeJBDM/gCtMARO0cLuT2HcEKnTPvhjV6aGeqrCB/sbNop0Kszm0jsaWU4A==` |
| `ethers@5.8.0` | MIT | `sha512-DUq+7fHrCg1aPDFCHx6UIPb3nmt2XMpM7Y/g2gLhsl3lIBqeAfOJIl1qEvRf2uq3BiKxmh6Fh5pfp2ieyek7Kg==` |
| `fastfile@0.0.20` | GPL-3.0 | `sha512-r5ZDbgImvVWCP0lA/cGNgQcZqR+aYdFx3u+CtJqUE510pBUVGMn4ulL/iRTI4tACTYsNJ736uzFxEBXesPAktA==` |
| `ffjavascript@0.2.63` | GPL-3.0 | `sha512-dBgdsfGks58b66JnUZeZpGxdMIDQ4QsD3VYlRJyFVrKQHb2kJy4R2gufx5oetrTxXPT+aEjg0dOvOLg1N0on4A==` |
| `ffjavascript@0.3.0` | GPL-3.0 | `sha512-l7sR5kmU3gRwDy8g0Z2tYBXy5ttmafRPFOqY7S6af5cq51JqJWt5eQ/lSR/rs2wQNbDYaYlQr5O+OSUf/oMLoQ==` |
| `ffjavascript@0.3.1` | GPL-3.0 | `sha512-4PbK1WYodQtuF47D4pRI5KUg3Q392vuP5WjE1THSnceHdXwU3ijaoS0OqxTzLknCtz4Z2TtABzkBdBdMn3B/Aw==` |
| `filelist@1.0.6` | Apache-2.0 | `sha512-5giy2PkLYY1cP39p17Ech+2xlpTRL9HLspOfEgm0L6CwBXBTgsK5ou0JtzYuepxkaQ/tvhCFIJ5uXo0OrM2DxA==` |
| `hash.js@1.1.7` | MIT | `sha512-taOaskGt4z4SOANNseOviYDvjEJinIkRgmp7LbKP2YTTmVxWBl87s/uzK9r+44BclBSp2X7K1hqeNfz9JbBeXA==` |
| `hmac-drbg@1.0.1` | MIT | `sha512-Tti3gMqLdZfhOQY1Mzf/AanLiqh1WTiJgEj26ZuYQ9fbkLomzGchCws4FyrSd4VkpBfiNhaE1On+lOz894jvXg==` |
| `hoopy@0.1.4` | MIT | `sha512-HRcs+2mr52W0K+x8RzcLzuPPmVIKMSv97RGHy0Ea9y/mpcaK+xTrjICA04KAHi4GRzxliNqNJEFYWHghy3rSfQ==` |
| `inherits@2.0.4` | ISC | `sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==` |
| `jake@10.9.4` | Apache-2.0 | `sha512-wpHYzhxiVQL+IV05BLE2Xn34zW1S223hvjtqk0+gsPrwd/8JNLXJgZZM/iPFsYc1xyphF+6M6EvdE5E9MBGkDA==` |
| `js-sha3@0.8.0` | MIT | `sha512-gF1cRrHhIzNfToc802P800N8PpXS+evLLXfsVpowqmAFR9uwbi89WvXg2QspOmXL8QL86J4T1EpFu+yUkwJY3Q==` |
| `jsonpath@1.3.0` | MIT | `sha512-0kjkYHJBkAy50Z5QzArZ7udmvxrJzkpKYW27fiF//BrMY7TQibYLl+FYIXN2BiYmwMIVzSfD8aDRj6IzgBX2/w==` |
| `logplease@1.2.15` | MIT | `sha512-jLlHnlsPSJjpwUfcNyUxXCl33AYg2cHhIf9QhGL2T4iPT0XPB+xP1LRKFPgIg1M/sg9kAJvy94w9CzBNrfnstA==` |
| `minimalistic-assert@1.0.1` | ISC | `sha512-UtJcAD4yEaGtjPezWuO9wC4nwUnVH/8/Im3yEHQP4b67cXlD/Qr9hdITCU1xDbSEXg2XKNaP8jsReV7vQd00/A==` |
| `minimalistic-crypto-utils@1.0.1` | MIT | `sha512-JIYlbt6g8i5jKfJ3xz7rF0LXmv2TkDxBLUkiBeZ7bAx4GnnNMr8xFpGnOxn6GhTEHx3SjRrZEoU+j04prX1ktg==` |
| `minimatch@5.1.9` | ISC | `sha512-7o1wEA2RyMP7Iu7GNba9vc0RWWGACJOCZBJX2GJWip0ikV+wcOsgVuY9uE8CPiyQhkGFSlhuSkZPavN7u1c2Fw==` |
| `nanoassert@2.0.0` | ISC | `sha512-7vO7n28+aYO4J+8w96AzhmU8G+Y/xpPDJz/se19ICsqj/momRbb9mh9ZUtkoJ5X3nTnPdhEJyc0qnM6yAsHBaA==` |
| `node-addon-api@3.2.1` | MIT | `sha512-mmcei9JghVNDYydghQmeDX8KoAm0FAiYyIcUt/N4nhyAipB17pllZQDOJD2fotxABnt4Mdz+dKTO7eftLg4d0A==` |
| `node-gyp-build@4.8.4` | MIT | `sha512-LA4ZjwlnUblHVgq0oBF3Jl/6h/Nvs5fzBLwdEF4nuxnFdsfajde4WfxtJr3CaiH+F6ewcIB/q4jQ4UzPyid+CQ==` |
| `r1csfile@0.0.48` | GPL-3.0 | `sha512-kHRkKUJNaor31l05f2+RFzvcH5XSa7OfEfd/l4hzjte6NL6fjRkSMfZ4BjySW9wmfdwPOtq3mXurzPvPGEf5Tw==` |
| `readable-stream@3.6.2` | MIT | `sha512-9u/sniCrY3D5WdsERHzHE4G2YCXqoG5FTHUiCC4SIbr6XcLZBY05ya9EKjYek9O5xOAwjGq+1JdGBAS7Q9ScoA==` |
| `safe-buffer@5.2.1` | MIT | `sha512-rp3So07KcdmmKbGvgaNxQSJr7bGVSVk5S9Eq1F+ppbRo70+YeaDxkw5Dd8NPN+GD6bjnYm2VuPuCXmpuYvmCXQ==` |
| `scrypt-js@3.0.1` | MIT | `sha512-cdwTTnqPu0Hyvf5in5asVdZocVDTNRmR7XEcJuIzMjJeSHybHl7vpB66AzwTaIg6CLSbtjcxc8fqcySfnTkccA==` |
| `snarkjs@0.7.6` | GPL-3.0 | `sha512-4uH1xA5JzVU5jaaWS2fXej3+RC6L5Erhr6INTJtUA27du4Elbh4VXCeeRjB4QiwL6N6y7SNKePw5prTxyEf4Zg==` |
| `source-map@0.6.1` | BSD-3-Clause | `sha512-UjgapumWlbMhkBgzT7Ykc5YXUT46F0iKu8SGXq0bcwP5dz/h0Plj6enJqjz1Zbq2l5WaqYnrVbwWOWMyF3F47g==` |
| `static-eval@2.1.1` | MIT | `sha512-MgWpQ/ZjGieSVB3eOJVs4OA2LT/q1vx98KPCTTQPzq/aLr0YUXTsgryTXr4SLfR0ZfUUCiedM9n/ABeDIyy4mA==` |
| `string_decoder@1.3.0` | MIT | `sha512-hkRX8U1WjJFd8LsDJ2yQ/wWWxaopEsABU1XfkM8A+j0+85JAGppt16cr1Whg6KIbb4okU6Mql6BOj+uup/wKeA==` |
| `tryer@1.0.1` | MIT | `sha512-c3zayb8/kWWpycWYg87P71E1S1ZL6b6IJxfb5fvsUgsf0S2MVGaDhDXXjDMpdCpfWXqptc+4mXwmiy1ypXqRAA==` |
| `tweetnacl-util@0.15.1` | Unlicense | `sha512-RKJBIj8lySrShN4w6i/BonWp2Z/uxwC3h4y7xsRrpP59ZboCd0GpEVsOnMDYLMmKBpYhb5TgHzZXy7wTfYFBRw==` |
| `tweetnacl@1.0.3` | Unlicense | `sha512-6rt+RN7aOi1nGMyC4Xa5DdYiukl2UWCbcJft7YhxReBGQD7OAM8Pbxw6YMo4r2diNEA8FEmu32YOn9rhaiE5yw==` |
| `underscore@1.13.8` | MIT | `sha512-DXtD3ZtEQzc7M8m4cXotyHR+FAS18C64asBYY5vqZexfYryNNnDc02W4hKg3rdQuqOYas1jkseX0+nZXjTXnvQ==` |
| `undici-types@8.11.2` | MIT | `sha512-iMVNmWZ0leK/goS6eXMizSzmm9CDWtyphwbaCms3DNLqRxDL+mMoNVcZMTyyVgXP0N+Z8neAMzDoUOUJL8veKg==` |
| `util-deprecate@1.0.2` | MIT | `sha512-EPD5q1uXyFxJpCrLnCc1nHnq3gOa6DZBocAIiI2TaSCA7VCJ1UJDMagCzIkXNsUYfD1daK//LTEQ8xiIbrHtcw==` |
| `wasmbuilder@0.0.16` | GPL-3.0 | `sha512-Qx3lEFqaVvp1cEYW7Bfi+ebRJrOiwz2Ieu7ZG2l7YyeSJIok/reEQCQCuicj/Y32ITIJuGIM9xZQppGx5LrQdA==` |
| `wasmcurves@0.2.2` | GPL-3.0 | `sha512-JRY908NkmKjFl4ytnTu5ED6AwPD+8VJ9oc94kdq7h5bIwbj0L4TDJ69mG+2aLs2SoCmGfqIesMWTEJjtYsoQXQ==` |
| `web-worker@1.2.0` | Apache-2.0 | `sha512-PgF341avzqyx60neE9DD+XS26MMNMoUQRz9NOZwW32nPQrF6p77f1htcnjBSEV8BGMKZ16choqUG4hyI0Hx7mA==` |
| `ws@8.22.0` | MIT | `sha512-Ydggc987+RO0AnWtZ/7Wq9FtNvcrL1b/RO0ud9mWjUPgDrsAAwQSF51sm2hm1XofbU/4jkpGEsLFsZZxU+1DOg==` |
