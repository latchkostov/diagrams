## CI flake measurement and state-based waits

Added a reproducible report of the latest 60 CI runs, including failures before cancellation, rerun
evidence and shard wall times. Recording tests wait for the real encoder to start and emit data;
health tests await the detector and lazy callout before advancing recovery. Refreshed the
duration balancer from one complete CI run. Product behavior and every output golden are unchanged.
