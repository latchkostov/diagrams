## Five drawing tutorials

Added five level-1 Basics lessons: quick-add, connection dots and reconnection, inserting a gateway, the property sheet, and Request versus Message. They use the existing canvas controls, contextual menus and inspector, with translated instructions, naming checks, Skip demos and generated UI solutions. The traffic lesson runs a saved seeded simulation and links to the blocking-call example.

The existing Relationship menu is now available in Live, so a Request can become a Message while watching its traffic. Skip now performs a sticky edit’s demo before remembering its completion, so connection lessons reconstruct correctly. Tutorial checks now resolve edge subjects across reconnects, inspect fixed connection sides and node documentation, and wait for counters from the rebuilt Live run after a structural edit. All tutorial behavior stays lazy and behind the existing release gate. No simulation, planning or stencil capability was added.

The only intended golden change is `node/i18n/catalogs.json`: 94 new tutorial messages increase the per-language catalog inventory from 3,102 to 3,196, update English-fallback counts, and change only the tutorials-area hashes. Shared existing translations cover some short labels; all other area hashes remain unchanged. Simulation, drawing, export and browser goldens are unchanged.
