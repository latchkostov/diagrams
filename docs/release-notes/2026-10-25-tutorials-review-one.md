## Tutorial navigation and translated instructions (PR #356, fix round 1)

Opening the active tutorial now keeps its history entry, so Exit returns to the original diagram.
The shortcuts sheet opens Tutorials through the app's view callback and closes itself. Tutorial TopBar,
shortcut, palette and finished-example navigation also stay in the same document. Device-file
Save bindings survive the round trip. TopBar, Examples/GalleryDetails, command palette, start card
and inspector entry points were audited: public app navigation uses view callbacks or tutorialRoute;
the release fragment contains no executable tutorial link. No new controls were added.

## Instructions and locale values

All 37 non-English catalogs now interpolate the exact name used by each label/field completion
check, and the same `Notifications:Token` constant used by both configuration checks. The stored
translated names are unchanged. This covers quick-add, insert-on-edge, property-sheet, boundaries,
API gateway and Kafka consumer naming. Coach marks share the same interpolated instructions.
Explicit search instructions also interpolate their solution query (quick-add, insert-on-edge,
command palette and API gateway). Dutch apostrophe quoting now permits ICU interpolation.

The exact name sources are `quickAdd.apiName`, `insertOnEdge.gatewayName`,
`propertySheet.paymentsName`, `propertySheet.subtitleValue`, `boundaries.boundaryName`,
`apiGateway.ordersName`, `apiGateway.usersName`, `kafkaTopic.billingName` and `kafkaTopic.emailName`.
`dependencies2.setting` is also byte-for-byte `Notifications:Token` in every catalog.

Every locale and every guided/solution stencil search runs against the real localized display
search index. Enter-driven picks must rank first. Invalid queries, ambiguous first results and
translated product spellings were corrected; working localized queries were retained. The English
insert query changes `gateway` → `apigw` to select Amazon API Gateway specifically, and the English
Kong query changes `kong gateway` → `Kong` to use the product name alone.

The table lists all changed non-English search values (duplicate uses within a locale are combined).

| Locale  | Search values: previous → corrected                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ar      | `المتصفح` → `browser`; `بوابة` → `apigw`; `بوستجرس` → `postgres`; `جوال` → `mobile`; `ريديس ذاكرة التخزين المؤقت` → `Redis ذاكرة التخزين المؤقت`; `سكوس` → `SQS`; `قائمة انتظار` → `generic قائمة انتظار`; `كونغ بوابة` → `Kong` |
| bg      | `конг шлюз` → `Kong`; `мобилен` → `mobile`; `шлюз` → `apigw`                                                                                                                                                                     |
| cs      | `brána` → `apigw`                                                                                                                                                                                                                |
| da      | `gateway` → `apigw`; `redis cache` → `Redis Cache`                                                                                                                                                                               |
| de      | `Gateway` → `apigw`; `Queue` → `generic Queue`                                                                                                                                                                                   |
| el      | `κινητό` → `mobile`; `πύλη` → `apigw`                                                                                                                                                                                            |
| es      | `navegador` → `browser`; `puerta de enlace` → `apigw`                                                                                                                                                                            |
| et      | `brauser` → `browser`; `lüüs` → `apigw`                                                                                                                                                                                          |
| fi      | `matkapuhelin` → `mobile`; `yhdyskäytävä` → `apigw`                                                                                                                                                                              |
| fr      | `file d’attente` → `generic File d’attente`; `passerelle` → `apigw`; `redis cache` → `Redis Cache`; `services` → `service`                                                                                                       |
| he      | `נייד\nשירות` → `mobile`; `קונג שער` → `Kong`; `שער` → `apigw`                                                                                                                                                                   |
| hi      | `एसक्यूएस` → `SQS`; `कोंग गेटवे` → `Kong`; `गेटवे` → `apigw`; `पोस्टग्रेज` → `postgres`; `ब्राउज़र` → `browser`; `रेडिस कैश` → `redis cache कैश`                                                                                 |
| hr      | `mobitel` → `mobile`; `pristupnik` → `apigw`; `usluga` → `service`                                                                                                                                                               |
| hu      | `átjáró` → `apigw`                                                                                                                                                                                                               |
| id      | `gateway` → `apigw`; `peramban` → `browser`; `persegi` → `SQS`; `ponsel` → `mobile`; `posting baru` → `postgres`; `ulang cache` → `Redis Cache`                                                                                  |
| it      | `cellulare` → `mobile`; `gateway` → `apigw`; `risdis cache` → `Redis Cache`                                                                                                                                                      |
| ja      | `ゲートウェイ` → `apigw`; `コン ゲートウェイ` → `Kong`; `ブラウザ` → `browser`; `ポストグレ` → `postgres`; `レディス キャッシュ` → `Redis キャッシュ`                                                                            |
| ko      | `게이트웨이` → `apigw`; `레디스 캐시` → `Redis 캐시`; `콩 게이트웨이` → `Kong`; `포스트그레스` → `postgres`                                                                                                                      |
| lt      | `kongas šliuzas` → `Kong`; `mobilusis` → `mobile`; `paslauga` → `service`; `šliuzas` → `apigw`                                                                                                                                   |
| lv      | `mobilais` → `mobile`; `pakalpojumu` → `service`; `pārlūkprogramma` → `browser`; `vārteja` → `apigw`                                                                                                                             |
| nb      | `gateway` → `apigw`                                                                                                                                                                                                              |
| nl      | `-dienst` → `service`; `gateway` → `apigw`; `herhaal cache` → `Redis Cache`                                                                                                                                                      |
| pl      | `brama` → `apigw`; `przeglądarka` → `browser`; `telefon komórkowy` → `mobile`                                                                                                                                                    |
| pt-BR   | `celular` → `mobile`; `gateway` → `apigw`; `navegador` → `browser`; `redis cache` → `Redis Cache`                                                                                                                                |
| pt-PT   | `celular` → `mobile`; `gateway` → `apigw`; `navegador` → `browser`; `redis cache` → `Redis Cache`                                                                                                                                |
| ro      | `gateway` → `apigw`; `redis cache` → `Redis Cache`                                                                                                                                                                               |
| ru      | `Постгрес` → `postgres`; `СКС` → `SQS`; `конг шлюз` → `Kong`; `мобильный` → `mobile`; `услуга` → `service`; `шлюз` → `apigw`                                                                                                     |
| sk      | `brána` → `apigw`                                                                                                                                                                                                                |
| sl      | `brskalnik` → `browser`; `mobilni telefon` → `mobile`; `prehod` → `apigw`; `čakalna vrsta` → `generic Čakalna vrsta`                                                                                                             |
| sr-Latn | `SKS` → `SQS`; `mobilni` → `mobile`; `mrežni prolaz` → `apigw`; `pretraživač` → `browser`; `usluga` → `service`                                                                                                                  |
| sv      | `gateway` → `apigw`; `redis cache` → `Redis Cache`                                                                                                                                                                               |
| th      | `ก้อง เกตเวย์` → `Kong`; `ทำซ้ำ แคช` → `Redis แคช`; `เกตเวย์` → `apigw`; `เบราว์เซอร์` → `browser`; `เอสคิวเอส` → `SQS`; `โพสต์เกรส` → `postgres`                                                                                |
| tr      | `Gateway` → `apigw`; `gönderiler` → `postgres`; `tarayıcı` → `browser`                                                                                                                                                           |
| uk      | `конг шлюз` → `Kong`; `послуга` → `service`; `шлюз` → `apigw`                                                                                                                                                                    |
| vi      | `dịch vụ` → `service`; `gateway` → `apigw`; `hàng đợi` → `generic Hàng đợi`; `làm lại bộ nhớ đệm` → `Redis Bộ nhớ đệm`; `trình duyệt` → `browser`                                                                                |
| zh-CN   | `redis缓存` → `Redis 缓存`; `孔网关` → `Kong`; `浏览器` → `browser`; `网关` → `apigw`                                                                                                                                            |
| zh-TW   | `redis快取` → `Redis 快取`; `孔閘道` → `Kong`; `瀏覽器` → `browser`; `移動` → `mobile`; `閘道` → `apigw`                                                                                                                         |

## Output parity

Only `tests/parity/goldens/node/i18n/catalogs.json` intentionally changes: tutorial namespace
fingerprints reflect placeholder instructions, preserved configuration keys and searchable queries
in English and all 37 translations; the pseudo-locale reflects the changed English templates.
No diagram, engine, export or browser golden is updated.

## Regression checks

Coverage includes self-link then Exit for both inspector lessons, native File Open then shortcuts
Tutorials and Ctrl+S without a picker, all-locale checked-value instructions and all localized
stencil queries. Temporarily removing navigation fixes and injecting one invalid query makes the
corresponding tests fail. The original catalogs also fail the new instruction and search tests.

## Sizes and validation

Production gzip bytes: entry 108,763 / 123,500; startup 160,210 / 177,000; canvas first view
367,929 / 383,000; Live session 131,614 / 135,000. The skill ZIP is 818,154 bytes, strictly below
835,000. Entry/viewer/Forge size checks and all 26 production bundle-split assertions pass;
no budget was changed.

The targeted tutorial/i18n unit run reports 3,290 passed and one existing completion-sweep
hang-backstop failure. The same case fails identically in the second full-spec run on clean
origin/master (1,861 passed, one failed); the first clean-master run passes all 1,862 cases.
The isolated case passes on both revisions. Reproduction and follow-up:
[completion-sweep backlog](../backlog/2026-10-25-tutorial-completion-backoff-timeout.md).
The all-locale catalog/instruction/search regressions pass. Regeneration and i18n validation pass
with the existing missing/stale-translation warnings. Targeted i18n parity checks three goldens:
zero changed, added, missing or stale after the one deliberate catalog update.

Production-build e2e summaries: `181 passed (7.9m)` for tutorials and subpath, followed by
`3 passed (17.3s)` for the final expanded navigation regressions. The latter includes tutorial
TopBar and shortcuts round trips before saving back to the opened native file. Playwright stopped
its servers. The fix-round override leaves the full gate to PR CI.
