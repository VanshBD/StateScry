# Security policy

## Supported versions

The latest StateScry release receives security fixes. Older artifacts are supported only
for migration testing and should not be used for new automation.

## Reporting

Use GitHub private security advisories after the public repository is created. Do not
open a public issue with an exploit, credential, private application evidence, storage
state, trace, or screenshot. Include affected version, impact, reproduction against a
non-production fixture, and suggested mitigation when possible.

## Security boundary

StateScry is a development/testing tool, not a browser sandbox, authorization system,
or proof of application security. Observe mode and request blocking reduce accidental
mutation but cannot make an untrusted target safe. Extension workers provide timeout,
crash, environment, data, and capability isolation; reviewed local JavaScript may still
use Node APIs and is not a hostile-code sandbox. See `THREAT_MODEL.md`.
