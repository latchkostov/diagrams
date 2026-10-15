import { DEPLOYMENT_VARIABLES } from "./deployment-env";
import { frameAncestorList } from "./self-host-headers";
import { hostingBase } from "./self-host-templates";

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be a mapping`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, name: string): string => {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
};

/** Build an image from the same values Helm deploys; never imply that runtime env can change the app. */
export function imageBuildArgs(values: unknown): string[] {
  const config = record(values, "values");
  const image = record(config.image, "image");
  const build = record(config.build, "build");
  const repository = text(image.repository, "image.repository");
  const tag = text(image.tag, "image.tag");
  if (!/^[a-z0-9][a-z0-9._/:-]*$/.test(repository) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(tag))
    throw new Error("Set a valid Docker image repository and version tag");
  const profile = text(build.profile, "build.profile");
  if (!["internal", "public"].includes(profile)) throw new Error("build.profile must be internal or public");
  const switches = record(build.switches, "build.switches");
  const args = ["build", "--tag", `${repository}:${tag}`, "--build-arg", `BUILD_PROFILE=${profile}`];
  for (const [key, value] of Object.entries(switches)) {
    if (!DEPLOYMENT_VARIABLES.some((variable) => variable === key)) throw new Error(`Unknown build switch: ${key}`);
    if (!["string", "boolean", "number"].includes(typeof value)) throw new Error(`Invalid value for ${key}`);
    args.push("--build-arg", `${key}=${String(value)}`);
  }
  const base = hostingBase(text(build.basePath, "build.basePath"));
  const ancestors = frameAncestorList(text(build.frameAncestors, "build.frameAncestors").split(/[\s,]+/));
  args.push("--build-arg", `BASE_PATH=${base}`, "--build-arg", `FRAME_ANCESTORS=${ancestors.join(" ")}`, ".");
  return args;
}
