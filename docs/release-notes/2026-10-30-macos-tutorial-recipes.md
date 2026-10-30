## macOS tutorial text recipes

Generated tutorial tests use Command+Down and Command+Up to reach the end and start of a text document on macOS. The native trace showed Command+End leaving the caret midway through a setting, so the next typed setting split an existing one. Windows and Linux recipes keep their existing keys.

Platform-specific unit coverage checks both document boundaries and preserves ordinary menu End keys. Native macOS validation comes from the branch Nightly; a Windows pass alone cannot verify macOS caret behavior. No output goldens change.
