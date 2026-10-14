import { useState } from "react";
import { ColorPickerModal } from "../components/ColorPickerModal";

/** Counts actual mutations separately from closing/focusing the real picker. */
export function ColourPickerLab() {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState("#11223344");
  const [writes, setWrites] = useState(0);
  return (
    <div>
      <button data-testid="colour-lab-open" onClick={() => setOpen(true)}>
        Colour
      </button>
      <output data-testid="colour-lab-writes">{writes}</output>
      <output data-testid="colour-lab-value">{color}</output>
      {open && (
        <ColorPickerModal
          currentColor={color}
          onClose={() => setOpen(false)}
          onSelect={(hex) => {
            setColor(hex);
            setWrites((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
