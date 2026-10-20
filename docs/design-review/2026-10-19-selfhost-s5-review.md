## Self-host S5 deployment review

This round changes operator configuration only and adds no editor controls or chrome. Static mode
retains its exact rendering. Server defaults now fit the documented container sizing plan; invalid
memory budgets produce an actionable startup message instead of risking an unexplained restart.
Explicit ingress timeout choices are preserved. Browser room coverage through both proxy families
is tracked separately; the existing smoke checks still cover two-way relay frames through them.
