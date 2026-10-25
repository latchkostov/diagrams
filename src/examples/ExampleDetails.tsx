import { DiagramThumbnail } from "../components/DiagramThumbnail";
import { exampleMetadata } from "./metadata";
import { GalleryDetails } from "./GalleryDetails";
import type { ExampleDetailsProps } from "./discovery";

/** Decoration/discovery only: completion never owns selection, loading a diagram or its camera. */
export function ExampleDetails(props: ExampleDetailsProps) {
  if (props.kind === "gallery") return <GalleryDetails {...props} />;
  const thumb = exampleMetadata[props.slug]?.thumb;
  return thumb ? <DiagramThumbnail thumb={thumb} testId={props.testId} /> : null;
}
