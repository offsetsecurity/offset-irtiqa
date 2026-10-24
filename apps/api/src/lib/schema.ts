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
