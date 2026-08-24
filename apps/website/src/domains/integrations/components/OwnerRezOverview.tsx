import {
  Badge,
  EmptyState,
  Metric,
  MetricStrip,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { Building2, CalendarClock } from "lucide-react";

import type {
  OwnerrezBooking,
  OwnerrezProperty,
} from "@stayw/integrations/ownerrez";

import type { IntegrationHighlights } from "../services/integrations.service";

/**
 * Purely presentational, read-only — no forms, no mutation actions. OwnerRez
 * remains the source of truth for the property portfolio; this only ever
 * displays what its API returns, never writes anything back.
 */
export function OwnerRezOverview({
  properties,
  bookings,
}: {
  properties: IntegrationHighlights<OwnerrezProperty>;
  bookings: IntegrationHighlights<OwnerrezBooking>;
}) {
  const propertyItems =
    properties.configured && properties.ok ? properties.items : [];
  const bookingItems = bookings.configured && bookings.ok ? bookings.items : [];
  const activeProperties = propertyItems.filter((p) => p.active).length;

  return (
    <div className="space-y-10">
      <MetricStrip xlColumns={3}>
        <Metric
          label="Total properties"
          value={
            properties.configured && properties.ok ? propertyItems.length : "—"
          }
          icon={Building2}
        />
        <Metric
          label="Active properties"
          value={
            properties.configured && properties.ok ? activeProperties : "—"
          }
          icon={Building2}
        />
        <Metric
          label="Upcoming bookings"
          value={bookings.configured && bookings.ok ? bookingItems.length : "—"}
          icon={CalendarClock}
        />
      </MetricStrip>

      <div>
        <SectionHeader title="Properties" size="lg" />
        {properties.configured === false ? (
          <p className="text-sm text-ink-muted">
            Not connected — set{" "}
            <code className="text-xs">OWNERREZ_USERNAME</code> and{" "}
            <code className="text-xs">OWNERREZ_API_TOKEN</code> to enable.
          </p>
        ) : properties.ok === false ? (
          <p className="text-sm text-error-500">
            Couldn&apos;t reach OwnerRez: {properties.error}
          </p>
        ) : propertyItems.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No properties found"
            description="OwnerRez returned no properties for this account."
          />
        ) : (
          <Table>
            <TableHead>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Key</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableHead>
            <TableBody>
              {propertyItems.map((property) => (
                <TableRow key={property.id}>
                  <TableCell>
                    <span className="font-medium text-ink">
                      {property.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {property.key}
                  </TableCell>
                  <TableCell>
                    <Badge tone={property.active ? "success" : "neutral"}>
                      {property.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <SectionHeader title="Upcoming bookings" size="lg" />
        {bookings.configured === false ? (
          <p className="text-sm text-ink-muted">
            Not connected — set{" "}
            <code className="text-xs">OWNERREZ_USERNAME</code> and{" "}
            <code className="text-xs">OWNERREZ_API_TOKEN</code> to enable.
          </p>
        ) : bookings.ok === false ? (
          <p className="text-sm text-error-500">
            Couldn&apos;t reach OwnerRez: {bookings.error}
          </p>
        ) : bookingItems.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No bookings found"
            description="No upcoming or recent bookings in the current lookback window."
          />
        ) : (
          <Table>
            <TableHead>
              <TableHeaderCell>Booking</TableHeaderCell>
              <TableHeaderCell>Property</TableHeaderCell>
              <TableHeaderCell>Arrival</TableHeaderCell>
              <TableHeaderCell>Departure</TableHeaderCell>
              <TableHeaderCell>Guests</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableHead>
            <TableBody>
              {bookingItems.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell className="font-medium text-ink">
                    #{booking.id}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {booking.property_id}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {booking.arrival}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {booking.departure}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {booking.guests_adults + booking.guests_children}
                  </TableCell>
                  <TableCell>
                    <Badge tone="neutral">{booking.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
