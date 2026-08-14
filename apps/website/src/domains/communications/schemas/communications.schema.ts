import { z } from "zod";

export const createMessageThreadSchema = z.object({
  propertyId: z.string().uuid().optional().or(z.literal("")),
  reservationId: z.string().uuid().optional().or(z.literal("")),
  guestId: z.string().uuid().optional().or(z.literal("")),
  subject: z.string().max(200).optional().or(z.literal("")),
  body: z.string().min(1).max(4000),
});

export type CreateMessageThreadInput = z.infer<
  typeof createMessageThreadSchema
>;

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
