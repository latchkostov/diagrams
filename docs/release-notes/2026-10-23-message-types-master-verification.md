## Message types: master integration

Merged master through `4bdf5af7` (#253 sampling work budgets and #254 hover-card Enter-to-pin and scrolling). The only conflict was the generated skill viewer: master supplied the starting copy, then `pnpm regen` rebuilt it from both sides' sources. The message-type lazy reader and recovery UI remain intact alongside master's sampling and keyboard changes.

## Download and first-view budgets

All four bundle gates pass without changing a limit:

| Bundle            | Gzip bytes |   Limit |
| ----------------- | ---------: | ------: |
| Entry             |    107,821 | 123,500 |
| Startup           |    173,182 | 177,000 |
| Canvas first view |    382,977 | 383,000 |
| Live session      |    134,079 | 135,000 |

The freshly built skill ZIP is 833,729 B against its 835,000 B limit, and the committed viewer matches a fresh build. No further lazy split or budget increase was needed. This merge introduces no additional golden changes beyond the message-type inventories already recorded in this PR.

## Hover-summary test targeting

Master's new compact-summary test hovered the centre of an edge's SVG bounding box. In this PR's webhook showcase, the callback edge crosses that point, so the test opened the callback's card instead of the dead-letter edge's. The test now hovers each edge's visible label using its test ID, without forcing the pointer action. Its expected card, pin state and horizontal and vertical overflow assertions remain unchanged. The original target reproduced the failure in the Linux repetitions, including with the correction temporarily reverted; no product behavior or golden changed.
