import "server-only";
import type { Skill } from "@/lib/skills/discover";

/**
 * Render the `<available_skills>` section for the system prompt. Returns "" when
 * there are no skills. Lists name + description only — the model loads a skill's
 * full instructions by calling the skill_load tool with its name.
 */
export function renderSkillsSection(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = [
    "## Skills (mandatory)",
    "Before replying, scan the skills below. If a skill matches — or is even " +
      "partially relevant to — the task, you MUST load it with skill_load(name) " +
      "and follow its instructions. Err on the side of loading: it is better to " +
      "have context you don't need than to miss critical steps or pitfalls. " +
      "Skills encode specialized, proven workflows and the user's preferred " +
      "approach — load them even for tasks you think you could handle with basic " +
      "tools.",
    "",
    "<available_skills>",
  ];
  for (const s of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(s.name)}</name>`);
    lines.push(`    <description>${escapeXml(s.description)}</description>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  lines.push("");
  lines.push("Only proceed without loading a skill if genuinely none are relevant.");
  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
