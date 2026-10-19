## Engine R2: preserve non-blocking thread ownership

Non-blocking sampled calls now keep a dedicated thread tail with its reservation, CPU parts and broker delivery group. Scaling a consumer down withholds its draining Kafka partition until the tail releases. Changing sampling scale preserves the existing reservation weight and deadline.

Thread admission and meters include capacity tails. Memory and request-scaler reads count resident requests once, preserving the admitted cohort across scale changes. Resident accounting stays constant-time; it does not walk queued requests or held calls. Synchronous releases mark admission dirty and drain iteratively, preventing stack overflows for immediate work and resumed backlogs.

Named regressions cover all four P1 findings and resource-backed scale changes with resources enabled and disabled. Removing the fixes reproduces all six regression failures. The two 2,000-message probes finish without throwing and remain within I1 of the same-window master counts (73 real requests at scale 1; 70 at scale 10).

No golden changes are intended in this review round. All scale-1 and older outputs must remain unchanged; the earlier R2 scale-10 blocking-call golden remains the only intentional change relative to master. No tolerance, hang backstop or generator was relaxed.
