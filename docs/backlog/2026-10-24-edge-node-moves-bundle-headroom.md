## Canvas first view headroom

Owner: canvas bundle trim follow-up. The PR 4 node-move carry integration adds 671 B gzip to
canvas first view against its merge base: 381,252 B of the fixed 383,000 B budget, leaving
1,748 B. Startup is 173,455 B of 177,000 B, leaving 3,545 B. Both are below the 8,192 B warning
floor. Schedule a separate trim PR for optional editor operations; keep the current limits.

## Trim 3 resolution and remaining work

Scheduled trim 3 restores canvas first view to 374,094 / 383,000 B gzip (8,906 B headroom).
Startup improves to 171,134 / 177,000 B (5,866 B headroom). Additional Live download is
126,976 / 135,000 B (8,024 B headroom). The canvas follow-up is resolved; retain this entry for
startup and Live headroom. Limits and output goldens are unchanged.
