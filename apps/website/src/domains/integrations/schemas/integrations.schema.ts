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
