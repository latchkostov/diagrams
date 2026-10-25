## Message types final fix-round UX review

The existing inspector controls and chrome budget are preserved. Imported rules remain paged, while every rule appended during the mounted editor's lifetime remains reachable in the normal control order whenever its snapshot is restored. Renames update only that snapshot's row identities, including after Undo and name reuse on another row.

The two overflow searches identify their owning fields to screen readers: “Search carried message types” and “Search Only pass message types”. Hover and keyboard readers keep their own canvas's SVG titles, then restore the original titles when interaction ends.

Rejected replacing the registry on Add because it drops earlier history associations. Rejected growing the imported page to reach appended rules because that mounts unrelated rows; rendering stays at the requested page plus surviving appended rules. No new global controls or bundle-budget increases were needed.
