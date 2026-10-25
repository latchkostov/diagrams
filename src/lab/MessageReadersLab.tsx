import { LabCanvas } from "./LabCanvas";
import { messageTypesFixture } from "./messageTypesFixture";

/** Identical edge IDs, different vocabularies: each reader must stay inside its own React Flow root. */
export function MessageReadersLab() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: 360 }}>
      {["West", "East"].map((name) => {
        const diagram = messageTypesFixture();
        diagram.nodes[0].props = { messageType: name };
        diagram.edges[2].props = { emits: `${name}Callback` };
        return (
          <div key={name} data-testid={`message-reader-${name}`} style={{ position: "relative", minHeight: 0 }}>
            <LabCanvas diagram={diagram} minimap={false} />
          </div>
        );
      })}
    </div>
  );
}
