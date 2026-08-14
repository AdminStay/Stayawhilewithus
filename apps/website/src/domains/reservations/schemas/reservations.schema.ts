import { z } from "zod";

export const createReservationSchema = z
  .object({
    propertyId: z.string().uuid(),
    primaryGuestId: z.string().uuid(),
    checkInDate: z.coerce.date(),
    checkOutDate: z.coerce.date(),
    adults: z.number().int().min(1).default(1),
    children: z.number().int().min(0).default(0),
    pets: z.number().int().min(0).default(0),
    totalAmount: z.number().min(0),
    specialRequests: z.string().max(2000).optional().or(z.literal("")),
  })
  .refine((input) => input.checkOutDate > input.checkInDate, {
    message: "checkOutDate must be after checkInDate",
    path: ["checkOutDate"],
  });

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const updateReservationStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "CONFIRMED",
    "CHECKED_IN",
    "CHECKED_OUT",
    "CANCELLED",
  ]),
});

export type UpdateReservationStatusInput = z.infer<
  typeof updateReservationStatusSchema
>;
