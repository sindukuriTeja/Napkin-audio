import { describe, expect, it } from "vitest";
import { createProject } from "../data/sampleProject";
import { craftQualityMarkdown, cueSheetMarkdown, productionNotesMarkdown, qcMarkdown, scriptMarkdown } from "./exportPackage";

describe("export package markdown", () => {
  it("generates script, cue, QC, craft, and production notes markdown", () => {
    const project = createProject();

    expect(scriptMarkdown(project)).toContain(project.brief.projectName);
    expect(cueSheetMarkdown(project)).toContain("## Voice");
    expect(qcMarkdown(project)).toContain("Human approval is required");
    expect(craftQualityMarkdown(project)).toContain("Overall:");
    expect(productionNotesMarkdown(project)).toContain("## Rights");
  });
});
