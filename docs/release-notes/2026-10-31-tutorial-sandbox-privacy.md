## Tutorial sandbox privacy survives Undo

Importing private content now keeps practice private until a fresh sandbox begins, including after public imports and Undo. Sharing and external AI remain blocked, and native downloads retain `private: true`.

Restart clears Undo and Redo before dropping privacy and on-device consent. Changing lessons or exiting discards the mounted sandbox and its history. On-device model permission now stays in the temporary privacy controller instead of attempting to update a library entry.

No output goldens change.
