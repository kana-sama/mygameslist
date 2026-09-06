import {
  isDeploymentCommitSha,
  parseDeploymentVersion,
} from "../src/shared/deploymentVersion";

const SHA_40 = "a".repeat(40);
const SHA_64 = "b".repeat(64);

describe("deployment version schema", () => {
  it.each([SHA_40, SHA_64])("accepts a lowercase Git object id (%s characters)", (sha) => {
    expect(isDeploymentCommitSha(sha)).toBe(true);
    expect(parseDeploymentVersion({ sourceCommitSha: sha })).toEqual({ sourceCommitSha: sha });
  });

  it("accepts an explicit null commit for a local build", () => {
    expect(parseDeploymentVersion({ sourceCommitSha: null })).toEqual({ sourceCommitSha: null });
  });

  it.each([
    undefined,
    null,
    true,
    42,
    {},
    [],
    { sourceCommitSha: undefined },
    { sourceCommitSha: 42 },
    { sourceCommitSha: "a".repeat(39) },
    { sourceCommitSha: "a".repeat(41) },
    { sourceCommitSha: "a".repeat(63) },
    { sourceCommitSha: "a".repeat(65) },
    { sourceCommitSha: "A".repeat(40) },
    { sourceCommitSha: ` ${SHA_40}` },
    { sourceCommitSha: SHA_40, extra: true },
  ])("rejects malformed or non-exact version metadata %#", (value) => {
    expect(() => parseDeploymentVersion(value)).toThrow();
  });

  it.each([
    null,
    undefined,
    1,
    true,
    "",
    "a".repeat(39),
    "a".repeat(41),
    "A".repeat(40),
    "g".repeat(40),
    "a".repeat(63),
    "a".repeat(65),
  ])("rejects a non-canonical commit SHA %#", (value) => {
    expect(isDeploymentCommitSha(value)).toBe(false);
  });
});
