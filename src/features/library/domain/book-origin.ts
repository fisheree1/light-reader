import { z } from 'zod';

export const bookOriginSchema = z.object({
  source: z.enum(['bilinovel', 'linovelib']),
  novelId: z.string().regex(/^\d{1,10}$/),
  volumeId: z.string().regex(/^\d{1,10}$/),
  url: z.url().max(2048),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  translators: z.array(z.string().max(200)).max(20),
});

export type BookOrigin = z.infer<typeof bookOriginSchema>;
