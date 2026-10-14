# Keyboard key names

Researched for i18n batch 3 (2026-10-14). These are display labels, never the values compared with
KeyboardEvent.key or the action registry's shortcut tokens. The per-language glossaries keep the
chosen labels under `keys`; the corresponding `keys.*` catalog messages are loaded with that locale.

Windows and Chrome's localized shortcut documentation sometimes spells out a key and sometimes uses
the legend printed on a keyboard. We use the compact form in a shortcut: German Strg, Umschalt and
Entf; French Maj and Suppr; Finnish Vaihto, Sarkain and Askelpalautin. Languages whose documentation
keeps Ctrl, Shift, Alt, Enter or Tab keep those legends. Space and the drag gesture have local names.
Arabic keeps the Latin modifier legends, as Chrome does, and uses مسافة for Space.

macOS uses ⌘ for Mod, ⌃ for the actual Control key, ⌥ for Option, ⇧ for Shift, ⌦ for forward Delete,
⌫ for Backspace and the same arrow symbols in every language. Combinations join without +. Other
platforms join with +. Escape, Enter, Tab and Space use the table's local labels. Historical English
AI tooltips retain their existing + separators and wording; the sheet retains its existing Mac symbols.
Keyboard combinations are isolated left to right even inside RTL chrome.

Sources: [Windows shortcuts (German)](https://support.microsoft.com/de-de/accessibility/windows/keyboard-shortcuts-in-windows),
[Windows shortcuts (French)](https://support.microsoft.com/fr-fr/accessibility/windows/keyboard-shortcuts-in-windows),
[Chrome shortcuts (German)](https://support.google.com/chrome/answer/157179?hl=de),
[Chrome shortcuts (French)](https://support.google.com/chrome/answer/157179?hl=fr),
[Chrome shortcuts (Finnish)](https://support.google.com/chrome/answer/157179?hl=fi),
[Chrome shortcuts (Arabic)](https://support.google.com/chrome/answer/157179?hl=ar),
[Apple's modifier conventions](https://support.apple.com/de-de/102650).
Chrome's language selector provides the same Windows/Linux and Mac tables for the remaining locales;
the glossary records our compact choices where vendors differ. These machine-translated catalogs
are still unreviewed; a fluent reviewer can refine key labels along with the rest of the glossary.

| Locale  | Ctrl | Shift    | Alt | Delete | Backspace      | Escape | Enter   | Tab     | Space       | Drag           |
| ------- | ---- | -------- | --- | ------ | -------------- | ------ | ------- | ------- | ----------- | -------------- |
| en      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Space       | Drag           |
| ar      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | مسافة       | سحب            |
| bg      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Интервал    | Плъзгане       |
| cs      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Mezerník    | Tažení         |
| da      | Ctrl | Skift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Mellemrum   | Træk           |
| de      | Strg | Umschalt | Alt | Entf   | Rücktaste      | Esc    | Eingabe | Tab     | Leertaste   | Ziehen         |
| el      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Διάστημα    | Σύρσιμο        |
| es      | Ctrl | Mayús    | Alt | Supr   | Retroceso      | Esc    | Intro   | Tab     | Espacio     | Arrastrar      |
| et      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Tühik       | Lohistamine    |
| fi      | Ctrl | Vaihto   | Alt | Del    | Askelpalautin  | Esc    | Enter   | Sarkain | Välilyönti  | Vedä           |
| fr      | Ctrl | Maj      | Alt | Suppr  | Retour arrière | Échap  | Entrée  | Tab     | Espace      | Glisser        |
| he      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | רווח        | גרירה          |
| hi      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | स्पेस       | खींचें         |
| hr      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Razmaknica  | Povlačenje     |
| hu      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Szóköz      | Húzás          |
| id      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Spasi       | Seret          |
| it      | Ctrl | Maiusc   | Alt | Canc   | Backspace      | Esc    | Invio   | Tab     | Spazio      | Trascina       |
| ja      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | スペース    | ドラッグ       |
| ko      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | 스페이스    | 드래그         |
| lt      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Tarpas      | Vilkimas       |
| lv      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Atstarpe    | Vilkšana       |
| nb      | Ctrl | Shift    | Alt | Del    | Tilbake        | Esc    | Enter   | Tab     | Mellomrom   | Dra            |
| nl      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Spatie      | Slepen         |
| pl      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Spacja      | Przeciąganie   |
| pt-BR   | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Espaço      | Arrastar       |
| pt-PT   | Ctrl | Shift    | Alt | Del    | Retrocesso     | Esc    | Enter   | Tab     | Espaço      | Arrastar       |
| ro      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Spațiu      | Tragere        |
| ru      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Пробел      | Перетаскивание |
| sk      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Medzerník   | Ťahanie        |
| sl      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Preslednica | Vlečenje       |
| sr-Latn | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Razmak      | Prevlačenje    |
| sv      | Ctrl | Skift    | Alt | Del    | Backsteg       | Esc    | Retur   | Tabb    | Blanksteg   | Dra            |
| th      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | เว้นวรรค    | ลาก            |
| tr      | Ctrl | Shift    | Alt | Del    | Geri al        | Esc    | Enter   | Tab     | Boşluk      | Sürükle        |
| uk      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Пробіл      | Перетягування  |
| vi      | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | Dấu cách    | Kéo            |
| zh-CN   | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | 空格        | 拖动           |
| zh-TW   | Ctrl | Shift    | Alt | Del    | Backspace      | Esc    | Enter   | Tab     | 空白鍵      | 拖曳           |
