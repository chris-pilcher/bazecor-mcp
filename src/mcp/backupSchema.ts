import { z } from "zod";

export const backupSchema = z
  .object({
    neuron: z
      .object({
        device: z
          .object({ info: z.object({ product: z.string(), keyboardType: z.string() }).passthrough() })
          .passthrough(),
        layers: z.array(z.object({ name: z.string().max(128), id: z.number() })).optional(),
        macros: z.array(z.unknown()).optional(),
        superkeys: z.array(z.unknown()).optional(),
      })
      .passthrough(),
    backup: z.array(z.object({ command: z.string().min(1).max(128), data: z.string().max(262144) }).strict()).max(256),
  })
  .passthrough();
