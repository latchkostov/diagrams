## Skill ZIP diet UX review (2026-10-22)

The change reduces download size while preserving all unpacked content byte for byte.
Installation, offline HTML export, simulation playback, font coverage, every stencil and
all existing controls retain their behavior. There are no new controls or copy to learn.
The archive remains a normal DEFLATE ZIP accepted by existing unzip tools.

The existing download budget is unchanged. The compressor runs only in build/dev tooling,
with no decoder or dependency added to the app, exported HTML or skill. Retaining each
entry's best existing zlib candidate also prevents a compression regression for an entry
that Zopfli cannot improve. The existing dev cache avoids recompressing an unchanged skill.

Rejected font subsetting and SVG rounding because authored diagram text and geometry must
remain intact. Extra code minification offered only hundreds of bytes, so it is unnecessary.
Identity checks cover every archive entry; unchanged browser goldens and skill export tests
cover the user-facing output and offline workflow.
