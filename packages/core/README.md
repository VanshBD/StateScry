# StateScry core

Deterministic local engine for safe web behavior mapping, semantic state graphs,
incremental exploration, verified replay, diffing, benchmarks, coordinated matrices,
history, storage, and the dashboard API.

```js
import { resolveExploreOptions, exploreApplication } from "@statescry/core";

const options = await resolveExploreOptions({
  baseUrl: "http://127.0.0.1:3000",
  projectRoot: process.cwd(),
});
const run = await exploreApplication(options);
console.log(run.stats);
```

The default policy is same-origin, observe-only, metadata evidence. No account, API
key, paid AI provider, or hosted service is required.
