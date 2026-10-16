import { describeTransportConformance } from "./conformance";
import { MemoryNetwork } from "./memory";

describeTransportConformance("memory", (seed) => {
  const net = new MemoryNetwork({ seed });
  return {
    connect: () => net.connect(),
    settle: (idle) => net.settle(idle),
    setFaults: (f) => net.setFaults(f),
    partition: (groups) => net.partition(groups),
    heal: () => net.heal(),
    tap: (fn) => net.tap((r) => fn(r.bytes)),
    maxFrameBytes: net.maxFrameBytes,
  };
});
