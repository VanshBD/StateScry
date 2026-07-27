export default {
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    name: "invoice-domain",
    version: "1.0.0",
    description: "Example reviewed domain extension for invoice applications.",
    capabilities: ["actions", "assertions", "redactors", "matchers"],
    timeoutMs: 1000,
  },
  actions(snapshot) {
    return snapshot.textSample.includes("Invoice")
      ? [
          {
            name: "Open invoice details",
            kind: "click",
            selector: "[data-testid=invoice-details]",
          },
        ]
      : [];
  },
  assertions(input) {
    return {
      passed: input.snapshot.textSample.includes(input.expected),
      actual: input.snapshot.textSample,
      explanation: "Invoice domain text assertion.",
    };
  },
  redactors(input) {
    return { text: input.text.replace(/INV-\d+/g, "[invoice-id]") };
  },
  matchers(input) {
    const sameHeading = input.before.heading === input.after.heading;
    return {
      score: sameHeading ? 1 : 0.4,
      explanation: sameHeading
        ? "Invoice headings match exactly."
        : "Invoice headings changed.",
    };
  },
};
