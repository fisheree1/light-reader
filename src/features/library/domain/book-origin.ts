import { z } from 'zod';

export const bookOriginSchema = z.object({
  source: z.enum(['bilinovel', 'linovelib', 'syosetu']),
  // Numeric IDs for the light-novel sites; an ncode such as n4830bu for なろう.
  novelId: z.string().regex(/^(?:\d{1,10}|n\d{4}[a-z]{1,3})$/),
  volumeId: z.string().regex(/^\d{1,10}$/),
  url: z.url().max(2048),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  translators: z.array(z.string().max(200)).max(20),
  // Optional so origins saved before these fields existed stay valid.
  script: z.enum(['hans', 'hant', 'mixed', 'unknown']).optional(),
  translationMethod: z
    .enum(['human', 'machine', 'mixed', 'unknown'])
    .optional(),
  edition: z.string().max(40).nullable().optional(),
  volumeKind: z
    .enum(['main', 'side-story', 'collection', 'unknown'])
    .optional(),
});

export type BookOrigin = z.infer<typeof bookOriginSchema>;
