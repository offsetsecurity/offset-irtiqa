import { z } from "zod";

/**
 * The body of a PATCH: every field of the create schema, each optional, with
 * no defaults, and nothing else allowed.
 *
 * Not `schema.partial()`. Since zod 4 a field's default still applies inside a
 * partial, so a PATCH that only moved a due date came back with the status set
 * to "Open" and the linked controls emptied, and saved them. A field left out
 * of an update must stay what it was.
 */
export function patchOf<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodType<Partial<z.output<z.ZodObject<T>>>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let inner = field as z.ZodType;
    while (inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
    shape[key] = inner.optional();
  }
  return z.object(shape).strict() as unknown as z.ZodType<Partial<z.output<z.ZodObject<T>>>>;
}

/** Line breaks of every kind, and tabs: each run becomes one space. */
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]+/g;

/**
 * Characters that are invisible, or that make the text around them read as
 * something else, and that no name needs: the other control characters (C0,
 * DEL, C1), the soft hyphen, the Mongolian vowel separator, the zero-width
 * space, the direction embeddings and overrides (U+202A to U+202E), the word
 * joiner and invisible operators, the direction isolates (U+2066 to U+2069),
 * the deprecated format characters, the byte-order mark, the interlinear
 * annotation marks, and the tag characters (U+E0000 to U+E007F), which can
 * carry hidden text.
 *
 * Kept on purpose: the left-to-right, right-to-left and Arabic letter marks
 * (U+200E, U+200F, U+061C), which Arabic users add so a mixed name such as
 * one with "(CISO)" shows the right way round, and the zero-width non-joiner
 * and joiner (U+200C, U+200D), which Persian and the Indian scripts need.
 */
// eslint-disable-next-line no-control-regex -- finding control characters is the point
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u00AD\u180E\u200B\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;

/** One line of visible text: breaks become a space, hidden characters go, ends trimmed. */
export function cleanName(text: string): string {
  return text.replace(BREAKS, " ").replace(HIDDEN, "").trim();
}

/**
 * A person's name as typed into an owner, approver, tester or user name field.
 * It is cleaned rather than refused: a record saved before this rule may still
 * hold such a character, and the screens send the whole record back on every
 * save, so a refusal would block a change to its date or status with an error
 * about a character nobody can see. Cleaning also fixes the stored name the
 * next time the record is saved.
 */
export function personName(max: number, min = 0) {
  return z
    .string()
    .max(max)
    .transform(cleanName)
    .pipe(min > 0 ? z.string().min(min, "Enter a name.") : z.string());
}
