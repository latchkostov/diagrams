## Canvas first view headroom

Owner: canvas bundle trim follow-up. The PR 4 node-move carry integration adds 671 B gzip to
canvas first view against its merge base: 381,252 B of the fixed 383,000 B budget, leaving
1,748 B. Startup is 173,455 B of 177,000 B, leaving 3,545 B. Both are below the 8,192 B warning
floor. Schedule a separate trim PR for optional editor operations; keep the current limits.
