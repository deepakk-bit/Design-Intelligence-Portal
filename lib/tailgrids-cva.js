// Mini cva (class-variance-authority) interpreter.
//
// Given the source of a TailGrids registry .tsx file, extract the
// `cva("base", { variants, compoundVariants, defaultVariants })` call
// and turn it into a JS function: `(props) => composedClassName`.
//
// We don't try to handle every cva feature — just the subset TailGrids
// uses, which is:
//   - base string (single quoted argument)
//   - `variants`: { variantKey: { value: classString, ... } }
//   - `compoundVariants`: array of { ...conditions, className }
//     where each condition value is a literal or an array of literals
//   - `defaultVariants`: { variantKey: defaultValue }
//
// What we deliberately ignore:
//   - Multiple cva() calls in one file (we take the first)
//   - cva's `class` prop alias (we always look at `className`)
//   - Nested compound variants (cva itself doesn't support them)
//   - Polymorphic / slot-based components (handled separately by the
//     composer if/when needed)

// Locate the first `cva(...)` call in the source and return the
// (...) argument span as a string. Brace-counting parser — robust
// against arbitrary whitespace, line breaks, comments-with-braces.
export function extractCvaCall(source) {
  const idx = source.indexOf("cva(");
  if (idx < 0) return null;
  // Walk forward, counting parens/braces/strings, until we close the
  // initial paren of `cva(`.
  const start = idx + "cva(".length;
  let depth = 1;
  let i = start;
  let inString = null;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
    i++;
  }
  return null;
}

// Read a JS string literal at offset `i` (single, double, or backtick
// quoted). Returns { value, end } where `end` is the index after the
// closing quote, or null if no string is found.
//
// Handles adjacent string concatenation across newlines: `"foo" "bar"`
// or `"foo" + "bar"` — common in cva because string-concat is how the
// authors wrap long class lists onto multiple lines.
export function readStringLiteral(source, start) {
  let i = start;
  // Skip leading whitespace.
  while (i < source.length && /\s/.test(source[i])) i++;
  if (i >= source.length) return null;
  const quote = source[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  i++;
  let value = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      if (next === "n") value += "\n";
      else if (next === "t") value += "\t";
      else if (next === "r") value += "\r";
      else value += next;
      i += 2;
      continue;
    }
    if (ch === quote) {
      i++;
      // Look ahead for adjacent string concatenation.
      let j = i;
      while (j < source.length && /\s/.test(source[j])) j++;
      if (source[j] === "+") {
        j++;
        while (j < source.length && /\s/.test(source[j])) j++;
      }
      if (
        source[j] === '"' ||
        source[j] === "'" ||
        source[j] === "`"
      ) {
        const next = readStringLiteral(source, j);
        if (next) {
          return { value: value + " " + next.value, end: next.end };
        }
      }
      return { value, end: i };
    }
    value += ch;
    i++;
  }
  return null;
}

// Find a top-level key inside an object body and return its value span.
// `block` is the body without surrounding braces. The walk is char-by-
// char with depth/string awareness so we never match a key inside a
// nested object.
//
// Returns { start, end } — start is the index of the first char of the
// value (the opening `{`/`[`/quote), end is one past its closing
// counterpart. For unbraced literal values, end is the comma/newline
// terminator.
function findKeyValueSpan(block, key) {
  let i = 0;
  let depth = 0;
  let inString = null;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < block.length) {
    const ch = block[i];
    const next = block[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      i++;
      continue;
    }
    // Try to match `<key>:` (with optional whitespace) at this depth-0
    // position. Boundary: previous char must be start-of-block,
    // whitespace, or a comma — otherwise we'd match e.g. `variant`
    // inside `compoundVariants`.
    if (depth === 0 && block.slice(i, i + key.length) === key) {
      const before = i === 0 ? null : block[i - 1];
      const isBoundary = before === null || /[\s,]/.test(before);
      let j = i + key.length;
      while (j < block.length && /\s/.test(block[j])) j++;
      if (isBoundary && block[j] === ":") {
        j++;
        while (j < block.length && /\s/.test(block[j])) j++;
        return readValueSpan(block, j);
      }
    }
    i++;
  }
  return null;
}

// Read the value at offset `start` and return its span. Handles
// braced (`{...}`), bracketed (`[...]`), and quoted (`"..."`) values
// plus bare literals (booleans/numbers).
function readValueSpan(block, start) {
  const open = block[start];
  if (open === "{" || open === "[" || open === "(") {
    const closeChar = open === "{" ? "}" : open === "[" ? "]" : ")";
    let d = 1;
    let s = null;
    let j = start + 1;
    while (j < block.length && d > 0) {
      const c = block[j];
      if (s) {
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === s) s = null;
        j++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        s = c;
        j++;
        continue;
      }
      if (c === open) d++;
      else if (c === closeChar) d--;
      j++;
    }
    return { start, end: j };
  }
  if (open === '"' || open === "'" || open === "`") {
    const lit = readStringLiteral(block, start);
    if (!lit) return { start, end: start };
    return { start, end: lit.end };
  }
  // Literal — read up to comma or newline.
  let j = start;
  while (j < block.length && block[j] !== "," && block[j] !== "\n") j++;
  return { start, end: j };
}

// Parse the cva options block (the second argument: `{...}`) into a
// structured form the interpreter can use. Returns:
//   { variants, compoundVariants, defaultVariants }
//
// `variants`        — { key: { value: classString, ... } }
// `compoundVariants` — [ { conditions, className }, ... ]
// `defaultVariants` — { key: literalValue }
function parseCvaOptions(optionsBlock) {
  const result = {
    variants: {},
    compoundVariants: [],
    defaultVariants: {},
  };

  const variantsSpan = findKeyValueSpan(optionsBlock, "variants");
  if (variantsSpan) {
    result.variants = parseVariantsBlock(
      optionsBlock.slice(variantsSpan.start + 1, variantsSpan.end - 1),
    );
  }

  const compoundSpan = findKeyValueSpan(optionsBlock, "compoundVariants");
  if (compoundSpan) {
    result.compoundVariants = parseCompoundArray(
      optionsBlock.slice(compoundSpan.start + 1, compoundSpan.end - 1),
    );
  }

  const defaultsSpan = findKeyValueSpan(optionsBlock, "defaultVariants");
  if (defaultsSpan) {
    result.defaultVariants = parseFlatLiteralObject(
      optionsBlock.slice(defaultsSpan.start + 1, defaultsSpan.end - 1),
    );
  }

  return result;
}

// Parse the inside of `variants: {...}`. Each top-level key is a variant
// name; its value is another object whose keys are variant values and
// whose values are class strings.
function parseVariantsBlock(inner) {
  const result = {};
  let i = 0;
  while (i < inner.length) {
    // Skip whitespace and commas.
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    // Skip comments.
    if (inner[i] === "/" && inner[i + 1] === "/") {
      while (i < inner.length && inner[i] !== "\n") i++;
      continue;
    }
    if (inner[i] === "/" && inner[i + 1] === "*") {
      i = inner.indexOf("*/", i + 2);
      if (i < 0) break;
      i += 2;
      continue;
    }
    // Read key.
    let keyEnd = i;
    if (inner[i] === '"' || inner[i] === "'") {
      const lit = readStringLiteral(inner, i);
      if (!lit) break;
      var key = lit.value;
      i = lit.end;
    } else {
      while (
        keyEnd < inner.length &&
        /[A-Za-z0-9_$]/.test(inner[keyEnd])
      ) {
        keyEnd++;
      }
      var key = inner.slice(i, keyEnd);
      i = keyEnd;
    }
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (inner[i] !== ":") {
      i++;
      continue;
    }
    i++;
    while (i < inner.length && /\s/.test(inner[i])) i++;
    // Read object value.
    if (inner[i] !== "{") {
      // Skip — unexpected shape.
      while (i < inner.length && inner[i] !== ",") i++;
      continue;
    }
    let depth = 1;
    let j = i + 1;
    let s = null;
    while (j < inner.length && depth > 0) {
      const c = inner[j];
      if (s) {
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === s) s = null;
        j++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        s = c;
        j++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    const objBody = inner.slice(i + 1, j - 1);
    result[key] = parseFlatStringObject(objBody);
    i = j;
  }
  return result;
}

// Parse `{ a: "x", b: "y" }` body (no surrounding braces) into
// { a: "x", b: "y" }. Values are strings only.
function parseFlatStringObject(inner) {
  const result = {};
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    // Comments.
    if (inner[i] === "/" && inner[i + 1] === "/") {
      while (i < inner.length && inner[i] !== "\n") i++;
      continue;
    }
    if (inner[i] === "/" && inner[i + 1] === "*") {
      i = inner.indexOf("*/", i + 2);
      if (i < 0) break;
      i += 2;
      continue;
    }
    // Key.
    let key;
    if (inner[i] === '"' || inner[i] === "'") {
      const lit = readStringLiteral(inner, i);
      if (!lit) break;
      key = lit.value;
      i = lit.end;
    } else {
      let kEnd = i;
      while (kEnd < inner.length && /[A-Za-z0-9_$]/.test(inner[kEnd])) {
        kEnd++;
      }
      key = inner.slice(i, kEnd);
      i = kEnd;
    }
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (inner[i] !== ":") break;
    i++;
    while (i < inner.length && /\s/.test(inner[i])) i++;
    // Value (string).
    const lit = readStringLiteral(inner, i);
    if (!lit) {
      // Could be an empty object value `{}` etc. — skip to next comma.
      while (i < inner.length && inner[i] !== ",") i++;
      continue;
    }
    result[key] = lit.value;
    i = lit.end;
  }
  return result;
}

// Parse a flat key:value object where values are literals (strings,
// numbers, booleans). Used for `defaultVariants`.
function parseFlatLiteralObject(inner) {
  const result = {};
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    // Key.
    let key;
    if (inner[i] === '"' || inner[i] === "'") {
      const lit = readStringLiteral(inner, i);
      if (!lit) break;
      key = lit.value;
      i = lit.end;
    } else {
      let kEnd = i;
      while (kEnd < inner.length && /[A-Za-z0-9_$]/.test(inner[kEnd])) {
        kEnd++;
      }
      key = inner.slice(i, kEnd);
      i = kEnd;
    }
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (inner[i] !== ":") break;
    i++;
    while (i < inner.length && /\s/.test(inner[i])) i++;
    // Value: string, true, false, number, or quoted.
    if (inner[i] === '"' || inner[i] === "'") {
      const lit = readStringLiteral(inner, i);
      if (!lit) break;
      result[key] = lit.value;
      i = lit.end;
    } else {
      let vEnd = i;
      while (vEnd < inner.length && !/[,\n]/.test(inner[vEnd])) vEnd++;
      const raw = inner.slice(i, vEnd).trim();
      if (raw === "true") result[key] = true;
      else if (raw === "false") result[key] = false;
      else if (/^-?\d+(\.\d+)?$/.test(raw)) result[key] = Number(raw);
      else result[key] = raw;
      i = vEnd;
    }
  }
  return result;
}

// Parse `compoundVariants: [ { ...condition, className: "..." }, ... ]`.
// The body inner (no surrounding brackets) is a list of object literals.
function parseCompoundArray(inner) {
  const result = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    if (inner[i] !== "{") {
      i++;
      continue;
    }
    // Capture balanced object body.
    let depth = 1;
    let j = i + 1;
    let s = null;
    while (j < inner.length && depth > 0) {
      const c = inner[j];
      if (s) {
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === s) s = null;
        j++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        s = c;
        j++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    const obj = parseCompoundEntry(inner.slice(i + 1, j - 1));
    if (obj) result.push(obj);
    i = j;
  }
  return result;
}

// Parse a single compound-variant entry into
// { conditions: { variantKey: literal | [literal, ...] }, className }.
// Comments inside the entry are tolerated.
function parseCompoundEntry(inner) {
  const conditions = {};
  let className = null;
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    // Skip comments.
    if (inner[i] === "/" && inner[i + 1] === "/") {
      while (i < inner.length && inner[i] !== "\n") i++;
      continue;
    }
    if (inner[i] === "/" && inner[i + 1] === "*") {
      i = inner.indexOf("*/", i + 2);
      if (i < 0) break;
      i += 2;
      continue;
    }
    // Read key.
    let key;
    if (inner[i] === '"' || inner[i] === "'") {
      const lit = readStringLiteral(inner, i);
      if (!lit) break;
      key = lit.value;
      i = lit.end;
    } else {
      let kEnd = i;
      while (kEnd < inner.length && /[A-Za-z0-9_$]/.test(inner[kEnd])) {
        kEnd++;
      }
      key = inner.slice(i, kEnd);
      i = kEnd;
    }
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (inner[i] !== ":") break;
    i++;
    while (i < inner.length && /\s/.test(inner[i])) i++;
    // Value: string, array, true, false, number.
    if (inner[i] === "[") {
      let depth = 1;
      let j = i + 1;
      let s = null;
      while (j < inner.length && depth > 0) {
        const c = inner[j];
        if (s) {
          if (c === "\\") {
            j += 2;
            continue;
          }
          if (c === s) s = null;
          j++;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          s = c;
          j++;
          continue;
        }
        if (c === "[") depth++;
        else if (c === "]") depth--;
        j++;
      }
      const arrInner = inner.slice(i + 1, j - 1);
      const items = [];
      let k = 0;
      while (k < arrInner.length) {
        while (k < arrInner.length && /[\s,]/.test(arrInner[k])) k++;
        if (k >= arrInner.length) break;
        if (arrInner[k] === '"' || arrInner[k] === "'") {
          const lit = readStringLiteral(arrInner, k);
          if (!lit) break;
          items.push(lit.value);
          k = lit.end;
        } else {
          let vEnd = k;
          while (vEnd < arrInner.length && !/[,\s]/.test(arrInner[vEnd])) {
            vEnd++;
          }
          const raw = arrInner.slice(k, vEnd).trim();
          if (raw === "true") items.push(true);
          else if (raw === "false") items.push(false);
          else if (/^-?\d+(\.\d+)?$/.test(raw)) items.push(Number(raw));
          else items.push(raw);
          k = vEnd;
        }
      }
      if (key === "className" || key === "class") {
        className = items.join(" ");
      } else {
        conditions[key] = items;
      }
      i = j;
    } else if (inner[i] === '"' || inner[i] === "'" || inner[i] === "`") {
      const lit = readStringLiteral(inner, i);
      if (!lit) break;
      if (key === "className" || key === "class") className = lit.value;
      else conditions[key] = lit.value;
      i = lit.end;
    } else {
      let vEnd = i;
      while (vEnd < inner.length && !/[,\n]/.test(inner[vEnd])) vEnd++;
      const raw = inner.slice(i, vEnd).trim();
      let val;
      if (raw === "true") val = true;
      else if (raw === "false") val = false;
      else if (/^-?\d+(\.\d+)?$/.test(raw)) val = Number(raw);
      else val = raw;
      if (key === "className" || key === "class") className = String(val);
      else conditions[key] = val;
      i = vEnd;
    }
  }
  return { conditions, className: className ?? "" };
}

// Top-level: parse a full registry source into a CvaSpec or null.
export function parseCvaFromSource(source) {
  const optsRaw = extractCvaCall(source);
  if (!optsRaw) return null;
  // The cva call is `cva(BASE, OPTIONS)`. Read the base string, then
  // skip the comma, then the options object body.
  const base = readStringLiteral(optsRaw, 0);
  if (!base) return null;
  // Find the comma after the base string.
  let i = base.end;
  while (i < optsRaw.length && /\s/.test(optsRaw[i])) i++;
  if (optsRaw[i] === ",") i++;
  while (i < optsRaw.length && /\s/.test(optsRaw[i])) i++;
  if (optsRaw[i] !== "{") {
    // Component has a base but no variants — return base only.
    return {
      base: base.value,
      variants: {},
      compoundVariants: [],
      defaultVariants: {},
    };
  }
  // Capture the options object body (without the surrounding braces).
  let depth = 1;
  let j = i + 1;
  let s = null;
  while (j < optsRaw.length && depth > 0) {
    const c = optsRaw[j];
    if (s) {
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === s) s = null;
      j++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      s = c;
      j++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    j++;
  }
  const optsBody = optsRaw.slice(i + 1, j - 1);
  const parsed = parseCvaOptions(optsBody);
  return { base: base.value, ...parsed };
}

// Apply variant props to a CvaSpec, returning the composed className.
//
// Order of class concatenation mirrors cva's runtime:
//   1. base
//   2. each variant key's matching value's classString
//   3. each compoundVariant whose conditions all match
//
// Defaults fill in any prop the caller didn't supply. Booleans are
// coerced to "true"/"false" string keys when looking up variants since
// cva spells them that way.
export function applyCva(spec, props) {
  if (!spec) return "";
  const merged = { ...spec.defaultVariants, ...stripUndefined(props) };
  const parts = [spec.base];

  for (const [key, value] of Object.entries(merged)) {
    const variantSet = spec.variants[key];
    if (!variantSet) continue;
    const lookupKey = typeof value === "boolean" ? String(value) : String(value);
    const cls = variantSet[lookupKey];
    if (cls) parts.push(cls);
  }

  for (const cv of spec.compoundVariants) {
    if (matchesCompoundConditions(cv.conditions, merged)) {
      if (cv.className) parts.push(cv.className);
    }
  }

  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function matchesCompoundConditions(conditions, merged) {
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = merged[key];
    if (Array.isArray(expected)) {
      // Match if any in the expected array equals actual.
      const matched = expected.some((e) => normaliseEq(e, actual));
      if (!matched) return false;
    } else {
      if (!normaliseEq(expected, actual)) return false;
    }
  }
  return true;
}

function normaliseEq(a, b) {
  // cva variant keys for booleans are spelled "true" / "false" but the
  // runtime can be passed either booleans or strings. Compare with
  // both spellings normalised.
  if (typeof a === "boolean" || typeof b === "boolean") {
    return String(a) === String(b);
  }
  return a === b;
}
