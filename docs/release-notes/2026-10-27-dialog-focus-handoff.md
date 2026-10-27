## Dialog replacement keeps the original keyboard opener

Closing a dialog opened from another dialog now returns focus to the original opener. For example,
File → Share → Interactive HTML → Escape returns to File. Opener capture waits for the outgoing
dialog's cleanup and survives StrictMode effect replay. No output goldens change.
