## R-489b900e79: Exercise successful parser recovery

PR #405 review round 2: the Skip and Continue parser-failure browser regressions currently stop at Retry. Extend them to allow the parser request, click `tutorial-retry`, reach the report step with the expected public fixture content, and verify ownership stays empty and failed attempts do not advance stored progress. Queued separately from the final sandbox privacy fix round.
