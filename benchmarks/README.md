# StateScry benchmark manifests

Benchmark manifests are independently reviewed behavior inventories. They turn
claims such as “accurate” into repeatable measurements, but only for the behavior
declared by the fixture.

Run a saved candidate against a manifest:

```bash
statescry benchmark <candidate-run> \
  --before <baseline-run> \
  --manifest benchmarks/checkout.json \
  --replay-results .statescry/replay-results.json \
  --completed-unapproved-mutations 0 \
  --detected-secret-leaks 0 \
  --output .statescry/quality/benchmark.md
```

The command exits with code 2 when a declared threshold fails. A high fixture score
does not prove universal application coverage or security. New manifests must be
reviewed separately from the implementation being evaluated.
