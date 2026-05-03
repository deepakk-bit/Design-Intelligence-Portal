import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readPrompt = (file) =>
  readFileSync(join(__dirname, "prompts", file), "utf8");

const interactionAnalystSchema = {
  type: "object",
  additionalProperties: false,
  required: ["usabilityScore", "summary", "strengths", "findings", "suggestions", "nextSteps"],
  properties: {
    usabilityScore: {
      type: "integer",
      description: "Honest 0–100 score. Anchor: ≤40 critical blockers, ~55 several major issues, ~85 polished with minor gaps, ≥95 exceptional.",
    },
    summary: {
      type: "string",
      description:
        "One paragraph (3–5 sentences) senior-reviewer verdict: overall take, most consequential issue, lift to fix.",
    },
    strengths: {
      type: "array",
      description: "2–4 specific things the component does well.",
      items: { type: "string" },
    },
    findings: {
      type: "array",
      description: "Ordered by severity, critical first. Cap around 8.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "severity",
          "category",
          "element",
          "observation",
          "why",
          "recommendation",
          "heuristic",
        ],
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "major", "minor", "nit"],
          },
          category: {
            type: "string",
            enum: [
              "state-coverage",
              "affordance",
              "feedback",
              "focus-keyboard",
              "a11y-semantics",
              "hierarchy",
              "edge-cases",
              "consistency",
            ],
          },
          element: {
            type: "string",
            description:
              "The specific UI element by visible label or location, e.g. \"primary 'Run' button, bottom-right of composer\".",
          },
          observation: { type: "string", description: "What you see (or can't see) in the screenshot." },
          why: {
            type: "string",
            description: "User-impact: who is affected and how this degrades the experience.",
          },
          recommendation: {
            type: "string",
            description:
              "Concrete, implementable change. Name the property/value/behavior, not just the goal.",
          },
          heuristic: {
            type: "string",
            description:
              "Anchor citation: Nielsen #N, WCAG SC X.Y.Z, Fitts/Hick, HIG/Material, etc.",
          },
        },
      },
    },
    nextSteps: {
      type: "array",
      description: "3–5 prioritized, concrete actions in execution order.",
      items: { type: "string" },
    },
    suggestions: {
      type: "array",
      description:
        "0–4 visual UI snippets demonstrating proposed improvements. Each snippet is self-contained renderable HTML with an inline <style> block (no scripts, no external resources, only inline SVG). Snippets render in a 480x260 sandboxed preview frame.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "target", "rationale", "snippetHtml"],
        properties: {
          title: {
            type: "string",
            description: "Short imperative title, e.g. 'Add visible focus ring to primary CTA'.",
          },
          target: {
            type: "string",
            description: "The element being demonstrated, e.g. 'Primary Run button, composer footer'.",
          },
          rationale: {
            type: "string",
            description: "1–2 sentences explaining what the snippet shows and why it improves the experience.",
          },
          snippetHtml: {
            type: "string",
            description:
              "Self-contained HTML with inline <style>. No <script>, no <link>, no external fonts/images. Inline SVG only. Render the proposed end state of the element, sized to fit a 480x260 preview.",
          },
        },
      },
    },
  },
};

export const AGENTS = {
  interaction: {
    id: "interaction",
    name: "Component Interaction Analyst",
    systemPrompt: readPrompt("interaction-analyst.md"),
    schema: interactionAnalystSchema,
    userInstruction:
      "Analyze the component in this screenshot for interaction quality. Output the JSON object only — no prose.",
  },
};

export function getAgent(id) {
  return AGENTS[id] ?? null;
}
