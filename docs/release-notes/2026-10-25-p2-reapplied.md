## Rate limit, rule identity and readout follow-ups

Reapplies the P2 work from #345 on top of #350's naming handover, without changing naming or keyboard ownership.

- #332: repeated Rate limit edits retain the same local request quota, preserving unrelated local,
  shared and non-request quotas. At 32 quotas, adding another local rate is disabled with an
  accessible explanation; existing rates remain editable and clearable. Live coverage checks
  traffic, invalid values, Undo, clearing and repeated edits. The existing public inline-rate-limit
  example already demonstrates this control; no new simulation or stencil is introduced.
- #334: surviving rule identities persist through duplicate-ID removal, reorder and reload,
  including R-e4bfd3e926 and transitive materialization repair (R-12b86d777e). Bulk quota limits
  apply in either selection order (R-d61492b595). Legacy and array rules have playback/seek
  equivalence coverage. Planning rejects oversized authored arrays before building mappings.
- #320: unrelated waiting-count mutations are filtered before protected-control scans;
  operation-count tests retain required note and overlay membership updates.

One golden intentionally changes: `node/i18n/catalogs.json` gains the English
`admission.quotaLimit` message. Every locale's message count increases by one; untranslated
locales gain one fallback and the admission-area fingerprint changes. All diagram-output
goldens remain unchanged. No golden is re-recorded to hide a behavioral failure.
