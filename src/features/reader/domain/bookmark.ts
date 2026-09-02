import { z } from 'zod';

import { bookLocatorSchema } from '../../../reader-engines/types';

export const bookmarkNameSchema = z.string().trim().min(1).max(120);

export const bookmarkSchema = z.object({
  id: z.string().trim().min(1).max(128),
  bookId: z.string().trim().min(1).max(128),
  name: bookmarkNameSchema,
  locator: bookLocatorSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Bookmark = z.infer<typeof bookmarkSchema>;
