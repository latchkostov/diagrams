## Lazy loading recovery review

The required designer review inspected the shared primitive and migrated surface diffs against
the UX principles. It found two regressions: reopening a failed surface after its toast disappeared
could leave no Retry, and the Live timeline's recovery targeted the Inspector's focus root.

Both are corrected. Each mount starts or joins a fresh attempt, while an earlier preload failure
does not mark the new owner's naming field unavailable. Timeline recovery targets `live-controls`;
Inspector fields keep their existing controller dispatch. Focus, remount and shared-chunk recovery
have focused regression tests.

No permanent chrome is added. Existing pending panel frames, localized statuses, close/Escape
controls, unavailable-owner markers and inline retries remain. The shared shell toast stays outside
the downloaded chunks, and recovering a shared chunk repairs every failed active consumer.
Specialised hold tests remain alongside the registry contracts so their stronger interaction and
styling assertions are preserved.
