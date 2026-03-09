import { defineCollection, z } from 'astro:content';

const diary = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    day: z.number().int().positive().optional(),
    mood: z.string().optional(),
    tags: z.array(z.string()).default([]),
    public: z.boolean().default(true),
    experiment: z.string().optional(),
    next: z.string().optional(),
  }),
});

export const collections = { diary };
