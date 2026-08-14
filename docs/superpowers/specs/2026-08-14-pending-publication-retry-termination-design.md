# Pending Publication Retry Termination Design

## Problem

The pending-publication refresh loop retries a `changed` result whenever the stored journal remains identity-compatible. If the stored raw journal does not advance, every retry receives the same `changed` result and the immediately resolved promise chain starves the test timeout and CI indefinitely.

The interactive-persistence test double also writes replacement journal bytes directly without advancing the interaction-rescue lineage watermark. That differs from the production installer and creates the stale-lineage state unintentionally, causing both the hanging compatible-replacement case and the failing initial-unconfirmed-write case.

## Approved behavior

- A compatible replacement installed through the normal journal transaction remains adoptable and publication synchronization completes.
- An unconfirmed write whose exact bytes can be read back and whose rescue lineage is durable remains recoverable and publication synchronization completes.
- A retry that reports `changed` without changing the compatible stored journal must terminate with an explicit publication error instead of retrying forever.
- The existing interaction remains authoritative and reloadable in every case.

## Design

In the durable refresh loop, compare the compatible journal raw discovered after `changed` with the raw used for that refresh attempt. Equal bytes prove that the retry made no progress, so abort with an error. A genuinely newer compatible raw is still adopted and retried.

Update the test double's simulated successful writes to invoke the production `replaceRescueLineage` callback before replacing journal bytes. Add a distinct forced stale-lineage result for the regression case so the no-progress guard is exercised intentionally rather than accidentally.

## Verification

Run the focused compatible-replacement regression first to demonstrate the pre-fix hang, then run the complete `tests/library-context.test.tsx` file and require all tests to finish and pass.
