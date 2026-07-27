# StateScry extension SDK

The SDK defines a versioned capability contract for domain actions, assertions,
redactors, and state matchers. Extensions are disabled unless explicitly configured.
Handlers run in a separate worker with an empty environment, bounded input/output,
schema checks, a timeout, and crash isolation.

This worker boundary is operational isolation, not a security sandbox: an extension is
local JavaScript and may use Node APIs. Install and enable only reviewed code. StateScry
redacts common secret fields and values before sending data to a handler.
