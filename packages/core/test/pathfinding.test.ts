import { describe, expect, it } from "vitest";

import { analyzeRun, shortestPath } from "../src/index.js";
import { run, state, transition } from "./fixtures.js";

describe("graph intelligence", () => {
  it("finds the shortest action path", () => {
    const graph = run(
      [
        state("root", "root", 0),
        state("middle", "middle", 1),
        state("end", "end", 2),
      ],
      [
        transition("root-middle", "root", "middle"),
        transition("middle-end", "middle", "end"),
        transition("root-end", "root", "end"),
      ],
    );

    expect(shortestPath(graph, "end")).toHaveLength(1);
  });

  it("detects dead ends and cycles", () => {
    const graph = run(
      [
        state("root", "root", 0),
        state("a", "a", 1),
        state("b", "b", 2),
        state("dead", "dead", 1),
      ],
      [
        transition("root-a", "root", "a"),
        transition("a-b", "a", "b"),
        transition("b-a", "b", "a"),
        transition("root-dead", "root", "dead"),
      ],
    );
    const analysis = analyzeRun(graph);

    expect(analysis.deadEnds.map((item) => item.id)).toEqual(["dead"]);
    expect(analysis.cycles).toHaveLength(1);
    expect(new Set(analysis.cycles[0])).toEqual(new Set(["a", "b"]));
  });
});
