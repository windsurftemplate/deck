import { describe, expect, it } from "vitest";
import { DOCS, parseQuiz, search } from "./content";

describe("help content", () => {
  it("bundles the manual and the course in order, each with a title", () => {
    expect(DOCS.some((d) => d.section === "manual")).toBe(true);
    expect(DOCS.some((d) => d.section === "course")).toBe(true);
    for (const d of DOCS) expect(d.title.length).toBeGreaterThan(2);
    const course = DOCS.filter((d) => d.section === "course").map((d) => d.order);
    expect(course).toEqual([...course].sort((a, b) => a - b));
  });
  it("every course chapter has a lab and a valid quiz", () => {
    for (const d of DOCS.filter((x) => x.section === "course")) {
      expect(d.body, d.id).toMatch(/^## Lab/m);
      const quizzes = [...d.body.matchAll(/```quiz\n([\s\S]*?)```/g)].map((m) => parseQuiz(m[1]!));
      expect(quizzes.length, d.id).toBeGreaterThanOrEqual(3);
      expect(quizzes.every(Boolean), d.id).toBe(true);
    }
  });
  it("parses quizzes and searches", () => {
    expect(parseQuiz("Q: 2+2?\n- [ ] 3\n- [x] 4\n> Because.")).toEqual({ question: "2+2?", options: [{ text: "3", correct: false }, { text: "4", correct: true }], explain: "Because." });
    expect(parseQuiz("Q: no answer\n- [ ] a\n- [ ] b")).toBeNull();
    expect(search("approval").length).toBeGreaterThan(0);
  });
});
