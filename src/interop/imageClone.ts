// html-to-image's toSvg and toPng (1.11.13, MIT, https://github.com/bubkoo/html-to-image), with the canvas cloned in
// time slices: the library clones the whole element tree in one chain of promises that never lets the page paint or
// take input (a 1,500-node diagram froze the tab for tens of seconds). This port makes the same calls in the same
// order, on the same nodes, so the same image comes out; between nodes it hands the thread back once a slice has run
// its time, reports how far it has got and stops if the export was cancelled. The image embedding and the
// serialising are sliced too; the library's other helpers (pseudo-elements, fonts, sizes) are used as they are.
//
// Two changes to the clone's per-property loop, neither changing what it writes: whether the node is an iframe is
// asked once per node, not once per property (the library asked it for each of the ~350 properties, walking the
// node's prototype chain each time), and the priority read from a computed style is dropped: it is always "".

import { applyStyle } from "html-to-image/es/apply-style";
import { clonePseudoElements } from "html-to-image/es/clone-pseudos";
import { isDataUrl, resourceToDataURL } from "html-to-image/es/dataurl";
import { embedResources } from "html-to-image/es/embed-resources";
import { embedWebFonts } from "html-to-image/es/embed-webfonts";
import { getMimeType } from "html-to-image/es/mimes";
import type { Options } from "html-to-image/es/types";
import {
  checkCanvasDimensions,
  getImageSize,
  getPixelRatio,
  getStyleProperties,
  isInstanceOfElement,
  toArray,
} from "html-to-image/es/util";

/** Where a sliced export is: called after each slice with the share of the tree cloned so far (0 to 1). */
export type Progress = (done: number) => void;

/**
 * Time slicing for one export: how long a slice may run, what to tell, the cancel, and a `check` that stops the
 * export at any slice (it throws).
 */
export class Slicer {
  /** Slices handed back so far (for tests). */
  yields = 0;
  private sliceStart = performance.now();
  private done = 0;
  constructor(
    private readonly total: number,
    private readonly opts: { signal?: AbortSignal; onProgress?: Progress; sliceMs?: number; check?: () => void } = {},
  ) {}

  /** Throws if the export was cancelled, or if its `check` says it can't go on. */
  stopIfAsked() {
    this.opts.signal?.throwIfAborted();
    this.opts.check?.();
  }

  /** `promise`, unless the export is cancelled first: a stalled download (a font, an image) never holds the page. */
  async wait<T>(promise: Promise<T>): Promise<T> {
    const signal = this.opts.signal;
    if (!signal) return promise;
    signal.throwIfAborted();
    let onAbort = () => {};
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(signal.reason as Error);
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** One node cloned: past the slice's time, lets the page paint and take input before going on. */
  async step(): Promise<void> {
    this.done++;
    await this.breathe();
  }

  /**
   * Past the slice's time: tells how far the clone has got, and lets the page paint and take input. Many callers at
   * once (the image embedding visits every node together) wait for the same next task, not one each.
   */
  async breathe(): Promise<void> {
    this.stopIfAsked();
    if (!this.gate) {
      if (performance.now() - this.sliceStart < (this.opts.sliceMs ?? 40)) return;
      this.opts.onProgress?.(this.total ? Math.min(1, this.done / this.total) : 1);
      this.gate = nextTask().then(() => {
        this.gate = undefined;
        this.yields++;
        this.sliceStart = performance.now();
      });
    }
    await this.gate;
    this.stopIfAsked();
  }
  private gate: Promise<void> | undefined;

  /** Between phases (fonts, images, drawing): the page paints once more, and a cancel stops here. */
  async pause(): Promise<void> {
    this.stopIfAsked();
    await nextTask();
    this.yields++;
    this.stopIfAsked();
    this.sliceStart = performance.now();
  }
}

/** A macrotask (not a microtask): the event loop renders a frame and runs input before it. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** The library's image loader, forwarding decode failures as well as load failures. */
function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      void img.decode().then(() => requestAnimationFrame(() => resolve(img)), reject);
    };
    img.onerror = reject;
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
  });
}

async function cloneCanvasElement(canvas: HTMLCanvasElement) {
  const dataURL = canvas.toDataURL();
  if (dataURL === "data:,") return canvas.cloneNode(false) as HTMLCanvasElement;
  return createImage(dataURL);
}

async function cloneVideoElement(video: HTMLVideoElement, options: Options) {
  if (video.currentSrc) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return createImage(canvas.toDataURL());
  }
  const poster = video.poster;
  const contentType = getMimeType(poster);
  const dataURL = await resourceToDataURL(poster, contentType, options);
  return createImage(dataURL);
}

async function cloneIFrameElement(iframe: HTMLIFrameElement, options: Options, slicer: Slicer) {
  try {
    if (iframe.contentDocument?.body) return (await cloneNode(iframe.contentDocument.body, options, slicer, true))!;
  } catch {
    // Failed to clone the iframe.
  }
  return iframe.cloneNode(false) as HTMLIFrameElement;
}

async function cloneSingleNode(node: HTMLElement, options: Options, slicer: Slicer): Promise<HTMLElement> {
  if (isInstanceOfElement(node, HTMLCanvasElement)) return cloneCanvasElement(node);
  if (isInstanceOfElement(node, HTMLVideoElement)) return cloneVideoElement(node, options);
  if (isInstanceOfElement(node, HTMLIFrameElement)) return cloneIFrameElement(node, options, slicer);
  return node.cloneNode(isSVGElement(node)) as HTMLElement;
}

const isSlotElement = (node: Node): node is HTMLSlotElement =>
  (node as Element).tagName != null && (node as Element).tagName.toUpperCase() === "SLOT";
const isSVGElement = (node: Node) =>
  (node as Element).tagName != null && (node as Element).tagName.toUpperCase() === "SVG";

async function cloneChildren(
  nativeNode: HTMLElement,
  clonedNode: HTMLElement,
  options: Options,
  slicer: Slicer,
): Promise<HTMLElement> {
  if (isSVGElement(clonedNode)) return clonedNode;
  let children: HTMLElement[];
  if (isSlotElement(nativeNode) && nativeNode.assignedNodes) children = toArray(nativeNode.assignedNodes());
  else if (isInstanceOfElement(nativeNode, HTMLIFrameElement) && nativeNode.contentDocument?.body)
    children = toArray(nativeNode.contentDocument.body.childNodes);
  else children = toArray((nativeNode.shadowRoot ?? nativeNode).childNodes);
  if (children.length === 0 || isInstanceOfElement(nativeNode, HTMLVideoElement)) return clonedNode;
  // One child after another, as the library's reduce over a promise chain does, with a slice check between them.
  for (const child of children) {
    const clonedChild = await cloneNode(child, options, slicer);
    if (clonedChild) clonedNode.appendChild(clonedChild);
    await slicer.step();
  }
  return clonedNode;
}

function cloneCSSStyle(nativeNode: HTMLElement, clonedNode: HTMLElement, options: Options) {
  const targetStyle = clonedNode.style;
  if (!targetStyle) return;
  const sourceStyle = window.getComputedStyle(nativeNode);
  if (sourceStyle.cssText) {
    targetStyle.cssText = sourceStyle.cssText;
    targetStyle.transformOrigin = sourceStyle.transformOrigin;
    return;
  }
  const iframe = isInstanceOfElement(nativeNode, HTMLIFrameElement);
  for (const name of getStyleProperties(options)) {
    let value = sourceStyle.getPropertyValue(name);
    if (name === "font-size" && value.endsWith("px")) {
      const reducedFont = Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1;
      value = `${reducedFont}px`;
    }
    if (iframe && name === "display" && value === "inline") value = "block";
    if (name === "d" && clonedNode.getAttribute("d")) value = `path(${clonedNode.getAttribute("d")})`;
    // A computed style's priority is always "" (the library read it per property).
    targetStyle.setProperty(name, value, "");
  }
}

function cloneInputValue(nativeNode: HTMLElement, clonedNode: HTMLElement) {
  if (isInstanceOfElement(nativeNode, HTMLTextAreaElement)) clonedNode.innerHTML = nativeNode.value;
  if (isInstanceOfElement(nativeNode, HTMLInputElement)) clonedNode.setAttribute("value", nativeNode.value);
}

function cloneSelectValue(nativeNode: HTMLElement, clonedNode: HTMLElement) {
  if (isInstanceOfElement(nativeNode, HTMLSelectElement)) {
    const selectedOption = Array.from(clonedNode.children).find(
      (child) => nativeNode.value === child.getAttribute("value"),
    );
    if (selectedOption) selectedOption.setAttribute("selected", "");
  }
}

function decorate(nativeNode: HTMLElement, clonedNode: HTMLElement, options: Options) {
  if (isInstanceOfElement(clonedNode, Element)) {
    cloneCSSStyle(nativeNode, clonedNode, options);
    clonePseudoElements(nativeNode, clonedNode, options);
    cloneInputValue(nativeNode, clonedNode);
    cloneSelectValue(nativeNode, clonedNode);
  }
  return clonedNode;
}

async function ensureSVGSymbols(clone: HTMLElement, options: Options, slicer: Slicer) {
  const uses = clone.querySelectorAll ? clone.querySelectorAll("use") : [];
  if (uses.length === 0) return clone;
  const processedDefs: Record<string, HTMLElement> = {};
  for (const use of uses) {
    const id = use.getAttribute("xlink:href");
    if (id) {
      const exist = clone.querySelector(id);
      const definition = document.querySelector<HTMLElement>(id);
      if (!exist && definition && !processedDefs[id])
        processedDefs[id] = (await cloneNode(definition, options, slicer, true))!;
    }
  }
  const nodes = Object.values(processedDefs);
  if (nodes.length) {
    const ns = "http://www.w3.org/1999/xhtml";
    const svg = document.createElementNS(ns, "svg") as unknown as HTMLElement;
    svg.setAttribute("xmlns", ns);
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    svg.style.overflow = "hidden";
    svg.style.display = "none";
    const defs = document.createElementNS(ns, "defs");
    svg.appendChild(defs);
    for (const node of nodes) defs.appendChild(node);
    clone.appendChild(svg);
  }
  return clone;
}

// The library's embedImages (embed-images.js), a node at a time with a slice check between them. Every node writes
// only its own style or source, so the order they run in doesn't change what they write.

async function embedProp(propName: string, node: HTMLElement, options: Options) {
  const propValue = node.style?.getPropertyValue(propName);
  if (propValue) {
    const cssString = await embedResources(propValue, null, options);
    node.style.setProperty(propName, cssString, node.style.getPropertyPriority(propName));
    return true;
  }
  return false;
}

async function embedBackground(clonedNode: HTMLElement, options: Options) {
  if (!(await embedProp("background", clonedNode, options))) await embedProp("background-image", clonedNode, options);
  for (const prop of ["mask", "-webkit-mask", "mask-image", "-webkit-mask-image"])
    if (await embedProp(prop, clonedNode, options)) break;
}

async function embedImageNode(clonedNode: HTMLElement | SVGImageElement, options: Options) {
  const isImageElement = isInstanceOfElement(clonedNode, HTMLImageElement);
  if (
    !(isImageElement && !isDataUrl(clonedNode.src)) &&
    !(isInstanceOfElement(clonedNode, SVGImageElement) && !isDataUrl(clonedNode.href.baseVal))
  )
    return;
  const url = isImageElement ? clonedNode.src : (clonedNode as SVGImageElement).href.baseVal;
  const dataURL = await resourceToDataURL(url, getMimeType(url), options);
  await new Promise((resolve, reject) => {
    const target = clonedNode as HTMLImageElement & SVGImageElement;
    target.onload = resolve;
    target.onerror = options.onImageErrorHandler
      ? (...attributes: unknown[]) => {
          try {
            resolve((options.onImageErrorHandler as (...a: unknown[]) => unknown)(...attributes));
          } catch (error) {
            reject(error as Error);
          }
        }
      : reject;
    const image = target as unknown as { decode?: unknown; loading?: string };
    if (image.decode) image.decode = resolve;
    if (image.loading === "lazy") image.loading = "eager";
    if (isImageElement) {
      (clonedNode as HTMLImageElement).srcset = "";
      (clonedNode as HTMLImageElement).src = dataURL;
    } else (clonedNode as SVGImageElement).href.baseVal = dataURL;
  });
}

/** Image loads kept in flight at once while the walk goes on (the library had every one in flight). */
const LOADS = 8;

/**
 * Visits the nodes one after another with a slice check between them (started all at once, thousands of siblings ran
 * their work without one), and loads up to LOADS images meanwhile, so the icons still download side by side.
 */
async function embedImages(root: Node, options: Options, slicer: Slicer): Promise<void> {
  const loads = new Set<Promise<void>>();
  const visit = async (node: Node): Promise<void> => {
    if (!isInstanceOfElement(node as Element, Element)) return;
    await slicer.breathe();
    await embedBackground(node as HTMLElement, options);
    const load = embedImageNode(node as HTMLElement, options);
    loads.add(load);
    void load.then(
      () => loads.delete(load),
      () => {},
    );
    if (loads.size >= LOADS) await Promise.race(loads);
    for (const child of toArray<Node>(node.childNodes)) await visit(child);
  };
  await visit(root);
  await Promise.all(loads);
}

/** The library's cloneNode, sliced. */
export async function cloneNode<T extends HTMLElement>(
  node: T,
  options: Options,
  slicer: Slicer,
  isRoot = false,
): Promise<T | null> {
  if (!isRoot && options.filter && !options.filter(node)) return null;
  let clone = await cloneSingleNode(node, options, slicer);
  clone = await cloneChildren(node, clone, options, slicer);
  clone = decorate(node, clone, options);
  return (await ensureSVGSymbols(clone, options, slicer)) as T;
}

/**
 * The library's nodeToDataURL and svgToDataURL: the clone in a foreignObject, serialised and percent-encoded. The
 * encoding (tens of megabytes for a big diagram) runs in slices: encoding the parts and joining them gives the same
 * text as encoding the whole, as long as no part ends between the two halves of a surrogate pair.
 */
async function nodeToDataURL(node: HTMLElement, width: number, height: number, slicer: Slicer): Promise<string> {
  return `data:image/svg+xml;charset=utf-8,${await encodeInSlices(await nodeToSvgText(node, width, height, slicer), slicer)}`;
}

/** The SVG text nodeToDataURL encodes: the clone in a foreignObject, serialised in slices. */
async function nodeToSvgText(node: HTMLElement, width: number, height: number, slicer: Slicer): Promise<string> {
  const xmlns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(xmlns, "svg");
  const foreignObject = document.createElementNS(xmlns, "foreignObject");
  svg.setAttribute("width", `${width}`);
  svg.setAttribute("height", `${height}`);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  foreignObject.setAttribute("width", "100%");
  foreignObject.setAttribute("height", "100%");
  foreignObject.setAttribute("x", "0");
  foreignObject.setAttribute("y", "0");
  foreignObject.setAttribute("externalResourcesRequired", "true");
  svg.appendChild(foreignObject);
  foreignObject.appendChild(node);
  const xml = await serializeInSlices(svg, node, slicer);
  await slicer.pause();
  return xml;
}

const XHTML = "http://www.w3.org/1999/xhtml";
/** Elements below this many descendants are serialised whole: splitting them saves nothing. */
const SPLIT_AT = 64;
/** A serialisation this port can't reproduce in parts (it then serialises the whole at once). */
class Unsplittable extends Error {}

/**
 * XMLSerializer's text for `svg`, made a part at a time with slices between: the frame around `root` (its
 * foreignObject) from a copy holding an empty `root`, then root's children, each serialised alone. Alone, an XHTML
 * element declares its namespace (` xmlns="http://www.w3.org/1999/xhtml"` right after its name), which inside its
 * XHTML parent it doesn't: that declaration is taken off, and nothing else differs. Big containers (the nodes', the
 * edges') are split again the same way. Anything else this can't be sure of (an element with namespaced or xmlns
 * attributes, a void element, text it didn't expect) is serialised whole, and if the frame isn't as expected the
 * whole picture is serialised at once, as before.
 */
export async function serializeInSlices(svg: SVGSVGElement, root: Element, slicer: Slicer): Promise<string> {
  const serializer = new XMLSerializer();
  const parent = root.parentNode;
  if (!parent) return serializer.serializeToString(svg);
  const empty = root.cloneNode(false);
  parent.replaceChild(empty, root);
  let frame: string;
  try {
    frame = serializer.serializeToString(svg);
  } finally {
    parent.replaceChild(root, empty);
  }
  const close = `</${root.localName}></foreignObject></svg>`;
  if (root.namespaceURI !== XHTML || root.prefix || !frame.endsWith(close)) return serializer.serializeToString(svg);
  try {
    const body = await serializeChildren(root, serializer, slicer);
    return frame.slice(0, frame.length - close.length) + body + frame.slice(frame.length - close.length);
  } catch (err) {
    if (!(err instanceof Unsplittable)) throw err;
    return serializer.serializeToString(svg);
  }
}

async function serializeChildren(el: Element, serializer: XMLSerializer, slicer: Slicer): Promise<string> {
  const parts: string[] = [];
  for (const child of el.childNodes) {
    parts.push(await serializeInContext(child, serializer, slicer));
    await slicer.breathe();
  }
  return parts.join("");
}

/** `node`'s text as it reads inside an XHTML parent. */
async function serializeInContext(node: Node, serializer: XMLSerializer, slicer: Slicer): Promise<string> {
  if (!(node instanceof Element)) return serializer.serializeToString(node);
  if (node.namespaceURI !== XHTML) return serializer.serializeToString(node);
  const declared = `<${node.localName} xmlns="${XHTML}"`;
  const inParent = (text: string) => {
    if (node.prefix || !text.startsWith(declared)) throw new Unsplittable();
    return `<${node.localName}` + text.slice(declared.length);
  };
  const plainAttributes = [...node.attributes].every((a) => !a.namespaceURI && !a.name.startsWith("xmlns"));
  if (!plainAttributes || node.getElementsByTagName("*").length < SPLIT_AT)
    return inParent(serializer.serializeToString(node));
  const shell = inParent(serializer.serializeToString(node.cloneNode(false)));
  const end = `></${node.localName}>`;
  // A void element (no end tag) or an unexpected form: whole.
  if (!shell.endsWith(end)) return inParent(serializer.serializeToString(node));
  const open = shell.slice(0, shell.length - end.length + 1);
  return open + (await serializeChildren(node, serializer, slicer)) + shell.slice(shell.length - end.length + 1);
}

/** encodeURIComponent, a part at a time. */
export async function encodeInSlices(text: string, slicer: Slicer, part = 1 << 20): Promise<string> {
  const parts: string[] = [];
  for (let at = 0; at < text.length;) {
    let end = Math.min(text.length, at + part);
    // Never between a high surrogate and its low one: each half alone is a malformed URI to encode.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end++;
    parts.push(encodeURIComponent(text.slice(at, end)));
    at = end;
    if (at < text.length) await slicer.pause();
  }
  return parts.join("");
}

/** The library's toSvg, sliced: a data URL of the node as an SVG. */
export async function toSvg(node: HTMLElement, options: Options, slicer: Slicer): Promise<string> {
  const { width, height } = getImageSize(node, options);
  return nodeToDataURL(await prepare(node, options, slicer), width, height, slicer);
}

/**
 * The text of the SVG toSvg encodes into its data URL (decoding that URL gives it back exactly): a file to save
 * needs no round trip through percent-encoding.
 */
export async function toSvgText(node: HTMLElement, options: Options, slicer: Slicer): Promise<string> {
  const { width, height } = getImageSize(node, options);
  return nodeToSvgText(await prepare(node, options, slicer), width, height, slicer);
}

/** The clone with its fonts and images embedded and the options' style applied. */
async function prepare(node: HTMLElement, options: Options, slicer: Slicer): Promise<HTMLElement> {
  const clonedNode = (await cloneNode(node, options, slicer, true))!;
  await slicer.pause();
  await slicer.wait(embedWebFonts(clonedNode, options));
  await slicer.wait(embedImages(clonedNode, options, slicer));
  await slicer.pause();
  applyStyle(clonedNode, options);
  return clonedNode;
}

/** The library's toPng, sliced up to the drawing (decoding and drawing the picture is one task of the browser's). */
export async function toPng(node: HTMLElement, options: Options, slicer: Slicer): Promise<string> {
  const { width, height } = getImageSize(node, options);
  const svg = await toSvg(node, options, slicer);
  await slicer.pause();
  const img = await slicer.wait(createImage(svg));
  slicer.stopIfAsked();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const ratio = options.pixelRatio || getPixelRatio();
  const canvasWidth = options.canvasWidth || width;
  const canvasHeight = options.canvasHeight || height;
  canvas.width = canvasWidth * ratio;
  canvas.height = canvasHeight * ratio;
  if (!options.skipAutoScale) checkCanvasDimensions(canvas);
  canvas.style.width = `${canvasWidth}`;
  canvas.style.height = `${canvasHeight}`;
  if (options.backgroundColor) {
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL();
  slicer.stopIfAsked();
  return png;
}
