## Focus follows the newer action

A canvas menu takes keyboard ownership when it opens. Earlier node or field focus work must
stand down before the menu takes focus. The controller now retires that pending move without
changing the roving Tab stop. Escape's existing invoker restoration remains covered.

Live popovers and dialogs keep their separate focus controllers. Canvas navigation and camera
rules are unchanged. This adds no controls, chrome or translation keys.
