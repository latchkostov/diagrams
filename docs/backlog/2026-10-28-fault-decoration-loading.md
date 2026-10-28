## Keep baseline fault decoration independent of chip loading (R-68774e9f4d)

Boundary outage and cut-link attributes currently wait for the optional chip module. Move these baseline decorations back into the eager Decorator, with a regression that applies faults before chip loading finishes.

Deferred from #378 fix round 1: the direct move exceeded the unchanged Live reserve by 102 bytes. Related simplifications still left it 47 bytes over. The round's P1 fixes keep within the reserve by converting sampled rates inside the lazy chip module; handling this P2 needs a separate, measured trim.
