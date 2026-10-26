## Tutorial fixes: navigation and translated instructions

The shortcuts link now acts as an in-app action and closes the sheet before opening Tutorials.
Returning to Diagram keeps its device-file Save destination. Tutorial chrome, palette and finished-example
actions also keep navigation inside the document. Inspector Learn links remain visible
and consistent, but opening the current lesson is harmless and Exit keeps its original destination.
Hiding them would remove context without fixing other entry points; the shared navigation guard
handles the whole class of duplicate-history bugs.

Instructions show exactly the name or key the learner must type, in their language. Configuration
keys retain their bytes. Search prompts show the same query the guided search and solution use;
product aliases remain recognizable and Enter always picks the intended stencil. No toolbar,
menu or chrome budget changes. Reviewed against teach-in-place, consistent affordances and no surprises.

No budgets, assertions or completion criteria were relaxed. Transliteration in the general stencil
index was rejected: these are authored tutorial queries, and introducing broad search semantics
would change discovery outside this fix. No new showcase is needed because this repairs existing lessons.
