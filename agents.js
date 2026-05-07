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

const statesVariantsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["componentName", "summary", "sections", "priorityOrder", "recommendations"],
  properties: {
    componentName: {
      type: "string",
      description: "Echo the canonical component name you're generating states for.",
    },
    summary: {
      type: "string",
      description:
        "1–2 sentence overview of what this component is and the most critical state-coverage concern for it.",
    },
    sections: {
      type: "array",
      description:
        "All seven sections, in this exact order: functional, validation, content, interaction, responsive, contextual, edgeCase.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "states"],
        properties: {
          id: {
            type: "string",
            enum: [
              "functional",
              "validation",
              "content",
              "interaction",
              "responsive",
              "contextual",
              "edgeCase",
            ],
          },
          title: { type: "string" },
          states: {
            type: "array",
            description:
              "Every applicable state/variant for this section. Use empty string for note if there's nothing useful to say.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "note"],
              properties: {
                name: {
                  type: "string",
                  description: "Short label, e.g. 'Hover', 'Disabled', 'Empty'.",
                },
                note: {
                  type: "string",
                  description:
                    "One-line design tip or pitfall. Empty string if nothing useful to add.",
                },
              },
            },
          },
        },
      },
    },
    priorityOrder: {
      type: "array",
      description:
        "Ordered state/variant names (matching states[].name above) from most to least critical to design first. 6–12 entries.",
      items: { type: "string" },
    },
    recommendations: {
      type: "array",
      description:
        "0–6 high-leverage best practices specific to designing this component well. Skip generic platitudes.",
      items: { type: "string" },
    },
  },
};

const qaReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "componentName",
    "summary",
    "issues",
    "checkCoverage",
    "recommendations",
  ],
  properties: {
    componentName: {
      type: "string",
      description:
        "Short label for what was QA'd, inferred from the screenshots or context.",
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: [
        "totalIssues",
        "highSeverity",
        "mediumSeverity",
        "lowSeverity",
        "verdict",
      ],
      properties: {
        totalIssues: { type: "integer" },
        highSeverity: { type: "integer" },
        mediumSeverity: { type: "integer" },
        lowSeverity: { type: "integer" },
        verdict: {
          type: "object",
          additionalProperties: false,
          required: ["status", "reason"],
          properties: {
            status: {
              type: "string",
              enum: ["ready", "conditional", "blocked"],
            },
            reason: {
              type: "string",
              description:
                "1–2 sentences stating which issues drive the verdict, citing them by title.",
            },
          },
        },
      },
    },
    issues: {
      type: "array",
      description:
        "Flat list of findings, sorted high → medium → low. Each row is rendered as a checkbox in the UI; keep it concise — no long descriptions.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "severity",
          "category",
          "location",
          "property",
          "designed",
          "built",
          "fix",
        ],
        properties: {
          title: {
            type: "string",
            description:
              "Short scannable label, 3–7 words. e.g. 'CTA padding too tight'.",
          },
          severity: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          category: {
            type: "string",
            enum: [
              "spacing",
              "color",
              "typography",
              "states",
              "components",
              "responsive",
              "accessibility",
            ],
          },
          location: {
            type: "string",
            description:
              "Short element + where, e.g. 'Primary CTA, header right'.",
          },
          property: {
            type: "string",
            description:
              "The precise property that differs, e.g. 'padding-x', 'background-color', 'font-weight', 'hover state', 'variant', 'label-text'.",
          },
          designed: {
            type: "string",
            description:
              "Concrete designed value. e.g. '16px', '600 (semibold)', '#0F172A', 'present'. If exact value is unreadable, give a clear relative value like '~16px'.",
          },
          built: {
            type: "string",
            description:
              "Concrete built value, parallel format to `designed`. e.g. '8px', 'missing', 'centered'.",
          },
          fix: {
            type: "string",
            description:
              "One-sentence actionable change a developer can apply.",
          },
        },
      },
    },
    checkCoverage: {
      type: "object",
      description:
        "Counts of issues per category. Must include all seven keys, even with 0.",
      additionalProperties: false,
      required: [
        "spacing",
        "color",
        "typography",
        "states",
        "components",
        "responsive",
        "accessibility",
      ],
      properties: {
        spacing: { type: "integer" },
        color: { type: "integer" },
        typography: { type: "integer" },
        states: { type: "integer" },
        components: { type: "integer" },
        responsive: { type: "integer" },
        accessibility: { type: "integer" },
      },
    },
    recommendations: {
      type: "object",
      additionalProperties: false,
      required: ["doNow", "thisSprint", "backlog"],
      properties: {
        doNow: {
          type: "array",
          description: "High-severity action items, phrased as imperatives.",
          items: { type: "string" },
        },
        thisSprint: {
          type: "array",
          description: "Medium-severity action items.",
          items: { type: "string" },
        },
        backlog: {
          type: "array",
          description: "Low-severity action items.",
          items: { type: "string" },
        },
      },
    },
  },
};

export const AGENTS = {
  interaction: {
    id: "interaction",
    name: "Component Interaction Analyst",
    inputs: ["image"],
    systemPrompt: readPrompt("interaction-analyst.md"),
    schema: interactionAnalystSchema,
    userInstruction:
      "Analyze the component in this screenshot for interaction quality. Output the JSON object only — no prose.",
  },
  "states-variants": {
    id: "states-variants",
    name: "States & Variants Generator",
    inputs: ["text"],
    systemPrompt: readPrompt("states-variants-generator.md"),
    schema: statesVariantsSchema,
    userInstruction:
      "Generate the complete states-and-variants checklist for the component below. Output the JSON object only — no prose.",
  },
  "reference-finder": {
    id: "reference-finder",
    name: "Reference Finder",
    // Special pipeline: stage-1 model extracts a query, server then calls
    // Refero MCP and returns reference cards. Strict JSON schema is used only
    // for the query-extraction stage.
    kind: "references",
    inputs: ["image", "text"],
    inputsRequireOneOf: ["image", "text"],
    systemPrompt: readPrompt("reference-finder.md"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "queryType", "platform"],
      properties: {
        query: {
          type: "string",
          description: "Concise 3–8 word search query for Refero.",
        },
        queryType: {
          type: "string",
          enum: ["screens", "flows"],
          description:
            "screens for one-off components/states/screens, flows for multi-step user journeys.",
        },
        platform: {
          type: "string",
          enum: ["ios", "web"],
          description:
            "Target platform: ios for native iPhone/iPad, web for everything else.",
        },
      },
    },
    userInstruction:
      "Extract the best Refero search query, queryType, and platform for what the user is designing. Output the JSON object only — no prose.",
  },
  "qa-review": {
    id: "qa-review",
    name: "QA Review",
    // Multi-image agent: design vs built comparison with a unified report
    // (summary + concise issue log + check coverage + recommendations).
    imageSlots: [
      {
        key: "designImage",
        label: "Design",
        help: "Figma export or design-file screenshot.",
      },
      {
        key: "builtImage",
        label: "Built",
        help: "Screenshot of the implemented UI.",
      },
    ],
    systemPrompt: readPrompt("qa-review.md"),
    schema: qaReviewSchema,
    userInstruction:
      "Compare the design (image 1) with the built implementation (image 2). Produce the unified QA review JSON only — no prose.",
  },
};

export function getAgent(id) {
  return AGENTS[id] ?? null;
}
