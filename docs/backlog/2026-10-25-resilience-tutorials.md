## Rate-limit tutorial: owner decision pending: 4

The requested second part moves from an inline Partner client → Rate Limiter → API diagram to
`shared-api-quotas`. The runtime has one sandbox per tutorial. The owner-question list dated
2026-10-25, item 4, reserves the choice of splitting this into two lessons. `rate-limit` is
quarantined in both catalog registrations until that decision is made; no split is assumed.

The inline portion includes seeded 20/s traffic, a 10/s quota and the rejected ≥ 10 moment.
The quota is configured in the starting diagram. The owner-decisions app batch adds the
`generic.rate-limiter` Inspector's Rate limit control (`inspector-field-rate-limit`), removing
that app prerequisite. The lesson's split and learner-edit choreography remain in the tutorial
lane; this entry does not release its quarantined registration.
