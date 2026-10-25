## Tutorial observation fixes

Rate-limit uses the same readout requirement as other watch steps, so playback alone cannot skip the observation.
Backlog-lag follows the connected consumer and requires its readout, keeping the existing Add a consumer action
and adding no controls or chrome. Reusing an unrelated service in the action was rejected because it would
change the action's established behavior instead of correcting the tutorial binding.
