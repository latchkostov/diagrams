## Protected filename uniqueness test can draw a duplicate

During R4 verification, `src/export/lock.test.ts`'s �names each protected file apart�
case drew 199 unique names from 200 calls and failed its exact uniqueness assertion.
Neither this test nor `src/export/lock.ts` differs from origin/master
`5dfc39bf42442ab5fe62c8043fbd8aa3d07368ee`.

A focused, deterministic reproduction ran twice against an archive of that clean
master source. An additional untracked test supplied WebCrypto with 199 distinct
five-byte suffixes followed by the first suffix again. Both runs reproduced the
same `expected 199 to be 200` failure. This controls the collision condition; it
does not claim two independent random collisions occurred on master. No production
source, original assertion or timeout was changed for the comparison.

The existing filename function maps random bytes directly into five characters,
so a collision is possible. Decide whether filenames must be unique within one
session and implement/test that contract deterministically. Do not weaken the
current test or expand this engine review into a filename behavior change merely
to hide the failure. Local comparison logs are in `tests/.output/r4-master-collision-{1,2}.log`.
