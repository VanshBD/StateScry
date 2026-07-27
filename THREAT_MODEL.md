# Threat model

## Protected assets

- Test credentials and Playwright storage state
- Application text, screenshots, traces, URLs, cookies, and network evidence
- Integrity of saved graphs, replay conclusions, benchmark scores, and CI reports
- Developer machines and repositories running hooks or extensions

## Trust boundaries

Targets, pages, responses, imported tests, configuration, hooks, extensions, old graph
files, and package artifacts are separate inputs. StateScry assumes the developer owns
or is authorized to test the target. The local operating-system account and explicitly
enabled hook/extension code remain trusted.

## Controls

- Same-origin navigation and non-mutating request policy by default
- Explicit method/URL allowlists for mutations and explicit flags for hooks/extensions
- Secret-pattern, URL, structured-field, and optional domain redaction before persistence
- Evidence minimization, bounded exploration, timeouts, exact replay verification
- Version/schema validation, checksum/SBOM/provenance generation, clean-room smoke tests
- Extension capability declarations, empty worker environment, sanitized bounded input,
  output validation, timeouts, and crash termination

## Residual risk

Browser actions can trigger application-specific side effects that are not visible from
HTTP semantics. Screenshots/traces can contain secrets. A reviewed extension can access
Node APIs because workers are operational isolation, not a hostile-code sandbox. Mapping
is bounded black-box observation, not exhaustive reachability or vulnerability proof.
Supply-chain attestations require the protected hosted workflow to be meaningful.
