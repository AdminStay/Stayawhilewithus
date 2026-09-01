import { z } from "zod";

export const disconnectIntegrationSchema = z.object({
  provider: z.enum([
    "OWNERREZ",
    "AIRBNB",
    "SLACK",
    "ASANA",
    "NOTION",
    "GMAIL",
    "GOOGLE_VOICE",
    "YALE",
    "AUGUST",
    "NEST",
    "ECOBEE",
    "CIELO",
  ]),
});

export type DisconnectIntegrationInput = z.infer<
  typeof disconnectIntegrationSchema
>;

export const searchNotionSchema = z.object({
  query: z.string().trim().min(1).max(200),
});

export type SearchNotionInput = z.infer<typeof searchNotionSchema>;
