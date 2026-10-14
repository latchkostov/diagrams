# Stencil catalog review fixes (2026-10-14)

Disposition of the five P2 findings in `.reviews/20261014-182643/REPORT.md` for PR #103.
All five are accepted. Findings 4 and 5 identify coverage gaps, rather than observed broken display lookups
or preview geometry.

| Finding                               | Verification and change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Deliberate regression                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Actual default under New nodes say | Confirmed: the details translated the subtitle while Add and New diagram stored the English default. Render `defaultSublabel` in this factual row; previews still translate. The browser test checks the promised subtitle against both creation paths.                                                                                                                                                                                                                                                 | Restoring the translated row in a production build fails on German `Datenbank` versus the promised `database`.                                                                                                                  |
| 2. Network-firewall vocabulary        | Confirmed in French and checked across all 37 locales. Corrected generic names/subtitles in fr, es, et, el, lt, lv, pt-BR, pt-PT, sr-Latn, tr, vi, th, ru and uk. Corrected adjacent firewall nouns in descriptions, including description-only fixes in ar, bg, fi, hr and sv; replaced unrelated French/Croatian SRX copy. Every language has glossary entries and catalog assertions covering names, subtitles, descriptions and chrome, with valid inflections/synonyms and explicit avoided terms. | Restoring all 19 affected catalogs fails all 19 approved-vocabulary cases, including the description-only fixes.                                                                                                                |
| 3. Shared discovery ranking           | Confirmed duplicated tiers and sorting. A React- and locale-free search core owns tokenization, word splitting, token weights, all-token matching and stable ranking. English aliases and localized index metadata stay separate; display search still combines the two scores per token.                                                                                                                                                                                                               | Restoring each duplicated search implementation independently fails the injected-weight test. It also covers mixed English/translated tokens, filtering and catalog-order ties.                                                 |
| 4. Display lookup coverage            | Confirmed: catalog/stamp checks did not prove lookup wiring. The pseudo-locale test checks exact display output for every catalog record and the fallback, with explicit product-name and technical-subtitle exceptions. All current mappings pass.                                                                                                                                                                                                                                                     | Removing the rate-limiter description lookup fails at that description, despite intact translations and source stamps.                                                                                                          |
| 5. Wrapped preview geometry           | Confirmed: the existing helper intentionally checked horizontal clipping only. Added stage vertical bounds, clipping-ancestor bounds and intersections with each preview's own figcaption, across all three node variants in en-XA at 1280×800. Four expanded names exercise the tiles and details.                                                                                                                                                                                                     | The same rendered drawer is deliberately clipped, then its node caption is moved onto its figcaption. Both are detected; disabling the full detector and disabling only its overlap checks independently fail its fixture test. |

No finding was rejected. Additional layout changes were rejected because the strengthened sample checks
pass with current geometry. Translating stored node defaults or pure product/protocol names was rejected
because those values belong to the file/agent contract or protected technical text.

## Terminology evidence

The French names now use the existing subtitle/description vocabulary, also used by
[Microsoft's French network-firewall documentation](https://support.microsoft.com/fr-fr/windows/security/firewall/what-is-a-firewall).
The other corrected terms follow existing valid subtitles/descriptions or Microsoft's localized usage:
[Spanish](https://learn.microsoft.com/es-es/windows/security/operating-system-security/network-security/windows-firewall/),
[Estonian](https://support.microsoft.com/et-ee/windows/security/firewall/what-is-a-firewall),
[Greek](https://support.microsoft.com/el-gr/windows/%CF%84%CE%B5%CE%AF%CF%87%CE%BF%CF%82-%CF%80%CF%81%CE%BF%CF%83%CF%84%CE%B1%CF%83%CE%AF%CE%B1%CF%82-%CE%BA%CE%B1%CE%B9-%CF%80%CF%81%CE%BF%CF%83%CF%84%CE%B1%CF%83%CE%AF%CE%B1-%CE%B4%CE%B9%CE%BA%CF%84%CF%8D%CE%BF%CF%85-%CF%83%CF%84%CE%B7%CE%BD-%CE%B5%CF%86%CE%B1%CF%81%CE%BC%CE%BF%CE%B3%CE%AE-%CE%B1%CF%83%CF%86%CE%AC%CE%BB%CE%B5%CE%B9%CE%B1%CF%82-%CF%84%CF%89%CE%BD-windows-ec0844f7-aebd-0583-67fe-601ecf5d774f),
[Lithuanian](https://support.microsoft.com/lt-lt/windows/security/firewall/what-is-a-firewall),
[Latvian](https://support.microsoft.com/lv-lv/windows/esiet-aizsarg%C4%81ts-ar-programmu-windows-dro%C5%A1%C4%ABba-2ae0363d-0ada-c064-8b56-6a39afb6a963),
[Portuguese](https://support.microsoft.com/pt-pt/windows/security/windows-security/firewall-and-network-protection-in-the-windows-security-app),
[Serbian](https://support.microsoft.com/sr-latn-rs/windows/za%C5%A1titni-zid-i-za%C5%A1tita-mre%C5%BEe-u-windows-bezbednost-aplikaciji-ec0844f7-aebd-0583-67fe-601ecf5d774f),
[Turkish](https://support.microsoft.com/tr-tr/windows/security/windows-security/firewall-and-network-protection-in-the-windows-security-app),
[Vietnamese](https://support.microsoft.com/vi-vn/office/t%C6%B0%E1%BB%9Dng-l%E1%BB%ADa-l%C3%A0-g%C3%AC-6870c88d-69b6-4db4-9cb1-0e4afa7a8603),
[Thai](https://support.microsoft.com/th-th/windows/security/firewall/what-is-a-firewall),
[Russian](https://support.microsoft.com/ru-ru/windows/security/windows-security/firewall-and-network-protection-in-the-windows-security-app)
and [Ukrainian](https://support.microsoft.com/uk-ua/windows/security/windows-security/firewall-and-network-protection-in-the-windows-security-app).
Valid alternatives in unaffected locales are retained in each glossary's accepted forms. This is a
network-firewall vocabulary check, not a fluent-person review of every sentence’s grammar.

## Validation

- `pnpm test`: 478 files passed; 6,152 tests passed and four skipped. The startup-chunk build-split checks passed.
- Production Chromium: all 169 tests passed across palette, gallery, stencils, network-devices, i18n and a11y,
  with ports 6160–6164 explicitly configured. Playwright stopped its servers; no listeners remain in 6160–6169.
- `pnpm build` and `pnpm size` passed: entry gzip 104.0 kB against the 123.5 kB budget.
- `pnpm i18n check` passed with zero errors and zero stale messages. Each catalog still reports 72 existing
  missing translations; length/typography warnings remain informational.
- Every deliberate regression failed as expected and was restored. The initial draft browser tests had
  setup failures (a navigation control absent in that gallery view, an unselected inspector and an incorrectly
  positioned overlap fixture); these were corrected before the passing production run.
- The initial final lint gate caught a forbidden non-null assertion in the new browser test. The test
  now reads the promised value with `innerText()`; its focused production rerun and the final gates pass.
- The designer-agent source and public en-XA screenshot review passed; details are in `docs/DESIGN-REVIEW.md`.
- `pnpm skill:check` initially warned about the viewer. `pnpm skill:release` refreshed it, and the subsequent
  check matched a fresh build. Plugin 1.1.17 is exactly one patch above origin/master's 1.1.16.
- origin/master moved from `ca41823` to `41d76bd` (autoscaling research) during the final push check.
  Rebased cleanly onto it; both branches’ documentation is retained. Plugin 1.1.17 remains one patch
  above master’s 1.1.16. Validation was repeated after the rebase.
