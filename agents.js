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

const qaComparisonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["componentName", "sections", "summary"],
  properties: {
    componentName: {
      type: "string",
      description:
        "Short label for what was QA'd, inferred from the screenshots or context.",
    },
    sections: {
      type: "array",
      description:
        "All seven sections in this exact order: spacing, color, typography, states, components, responsive, clarification. Empty issues[] if no findings.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "issues"],
        properties: {
          id: {
            type: "string",
            enum: [
              "spacing",
              "color",
              "typography",
              "states",
              "components",
              "responsive",
              "clarification",
            ],
          },
          title: { type: "string" },
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["location", "property", "designed", "built", "severity"],
              properties: {
                location: {
                  type: "string",
                  description:
                    "Which element and where, e.g. 'Primary CTA button, top-right of header'.",
                },
                property: {
                  type: "string",
                  description:
                    "The specific property that differs. Use the most precise label that fits, e.g. 'font-size', 'font-weight', 'line-height', 'padding-left', 'gap', 'background-color', 'border-radius', 'border-width', 'icon', 'label-text', 'shadow', 'opacity', 'alignment'. For state/component sections use a short noun like 'hover state', 'icon' or 'variant'. For clarification items use 'design intent'.",
                },
                designed: {
                  type: "string",
                  description:
                    "Concrete designed value for that property, e.g. '16px', '600 (semibold)', '#0F172A', 'present', 'left-aligned', 'check icon (lucide)'. Be specific. If exact pixels are unreadable, give a clear relative value like '~16px' or 'larger'.",
                },
                built: {
                  type: "string",
                  description:
                    "Concrete built value for that property, parallel format to `designed`. e.g. '14px', '500 (medium)', '#1E293B', 'missing', 'centered'.",
                },
                severity: {
                  type: "string",
                  enum: ["high", "medium", "low", "info"],
                  description:
                    "Use 'info' only for clarification-section items; otherwise high/medium/low.",
                },
              },
            },
          },
        },
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: [
        "totalIssues",
        "highSeverity",
        "mediumSeverity",
        "lowSeverity",
        "recommendedAction",
      ],
      properties: {
        totalIssues: {
          type: "integer",
          description: "Count of high + medium + low issues. Excludes info/clarification.",
        },
        highSeverity: { type: "integer" },
        mediumSeverity: { type: "integer" },
        lowSeverity: { type: "integer" },
        recommendedAction: {
          type: "string",
          enum: ["pass", "fix-and-requa", "needs-design-clarification"],
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
  "qa-report": {
    id: "qa-report",
    name: "QA Report",
    // Tool-driven pipeline: server captures a live screenshot of the URL and
    // pulls an HTML digest, then asks the model to QA against the design ref.
    kind: "qa-report",
    inputs: ["image", "text"],
    inputsRequireAll: ["image", "text"],
    textInputKind: "url",
    systemPrompt: readPrompt("qa-report.md"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "url",
        "summary",
        "verdict",
        "issues",
        "checkCoverage",
        "recommendations",
      ],
      properties: {
        url: { type: "string" },
        summary: {
          type: "object",
          additionalProperties: false,
          required: [
            "totalIssues",
            "highSeverity",
            "mediumSeverity",
            "lowSeverity",
          ],
          properties: {
            totalIssues: { type: "integer" },
            highSeverity: { type: "integer" },
            mediumSeverity: { type: "integer" },
            lowSeverity: { type: "integer" },
          },
        },
        verdict: {
          type: "object",
          additionalProperties: false,
          required: ["status", "reason"],
          properties: {
            status: {
              type: "string",
              enum: ["ready", "conditional", "blocked"],
            },
            reason: { type: "string" },
          },
        },
        issues: {
          type: "array",
          description:
            "Sorted: all high first, then medium, then low. One row per finding.",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "severity",
              "category",
              "description",
              "recommendation",
            ],
            properties: {
              name: { type: "string" },
              severity: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
              category: {
                type: "string",
                enum: [
                  "ui",
                  "copy",
                  "design-system",
                  "accessibility",
                  "responsiveness",
                ],
              },
              description: { type: "string" },
              recommendation: { type: "string" },
            },
          },
        },
        checkCoverage: {
          type: "object",
          additionalProperties: false,
          required: [
            "ui",
            "copy",
            "designSystem",
            "accessibility",
            "responsiveness",
          ],
          properties: {
            ui: { type: "integer" },
            copy: { type: "integer" },
            designSystem: { type: "integer" },
            accessibility: { type: "integer" },
            responsiveness: { type: "integer" },
          },
        },
        recommendations: {
          type: "object",
          additionalProperties: false,
          required: ["doNow", "thisSprint", "backlog"],
          properties: {
            doNow: { type: "array", items: { type: "string" } },
            thisSprint: { type: "array", items: { type: "string" } },
            backlog: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    userInstruction:
      "Compare the live screenshot (image 2) against the design reference (image 1). Use the page digest below for accessibility and copy checks. Output the JSON QA report only — no prose.",
  },
  "qa-comparison": {
    id: "qa-comparison",
    name: "QA Comparison",
    // Multi-image agent: declares ordered named slots so the API and UI can
    // render multiple dropzones and forward each image to the model in order.
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
    systemPrompt: readPrompt("qa-comparison.md"),
    schema: qaComparisonSchema,
    userInstruction:
      "Compare the design (image 1) with the built implementation (image 2). Produce the structured QA report. Output the JSON object only — no prose.",
  },
};

export function getAgent(id) {
  return AGENTS[id] ?? null;
}
