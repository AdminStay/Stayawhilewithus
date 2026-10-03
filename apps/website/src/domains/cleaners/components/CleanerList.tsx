import {
  Badge,
  Card,
  DialogTrigger,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { Users } from "lucide-react";

import type {
  CleanerContactView,
  CleanerView,
} from "../services/cleaners.service";

import { CleanerActionButton } from "./CleanerActionButton";
import { CleanerContactForm } from "./CleanerContactForm";
import { CleanerForm } from "./CleanerForm";
import type { CleanerAction } from "./types";

export interface CleanerContactActions {
  add: CleanerAction;
  update: CleanerAction;
  remove: CleanerAction;
}

/** "Jordan (Sister)", "Jordan", "(Sister)" or "Backup" when it's the cleaner's own second number. */
export function backupContactLabel(contact: CleanerContactView): string {
  if (contact.name && contact.relationship) {
    return `${contact.name} (${contact.relationship})`;
  }
  if (contact.name) return contact.name;
  if (contact.relationship) return `(${contact.relationship})`;
  return "Backup";
}

function BackupContacts({
  cleaner,
  canManage,
  contactActions,
}: {
  cleaner: CleanerView;
  canManage: boolean;
  contactActions: CleanerContactActions;
}) {
  if (cleaner.backupContacts.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {cleaner.backupContacts.map((contact) => {
        const label = backupContactLabel(contact);
        return (
          <li key={contact.id} className="flex flex-wrap items-center gap-1.5">
            <span>
              {label === "Backup" ? "Backup" : `Backup: ${label}`} ·{" "}
              {contact.phoneDisplay}
            </span>
            {contact.notes && (
              <span className="text-ink-faint">— {contact.notes}</span>
            )}
            {canManage && (
              <span className="inline-flex items-start gap-1">
                <DialogTrigger
                  label="Edit backup"
                  title={`Edit backup contact for ${cleaner.name}`}
                  variant="secondary"
                  showIcon={false}
                >
                  <CleanerContactForm
                    contact={contact}
                    action={contactActions.update}
                  />
                </DialogTrigger>
                <CleanerActionButton
                  action={contactActions.remove}
                  fields={{ id: contact.id }}
                  label="Remove backup"
                  variant="danger"
                  confirmMessage={`Remove this backup contact (${label}, ${contact.phoneDisplay}) for ${cleaner.name}?`}
                />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CleanerList({
  cleaners,
  canManage,
  updateAction,
  setStatusAction,
  contactActions,
}: {
  cleaners: CleanerView[];
  canManage: boolean;
  updateAction: CleanerAction;
  setStatusAction: CleanerAction;
  contactActions: CleanerContactActions;
}) {
  if (cleaners.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={Users}
          title="No cleaners yet"
          description={
            canManage
              ? "Add a cleaner, then assign them to properties below."
              : "No cleaners have been added yet."
          }
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>Cleaner</TableHeaderCell>
        <TableHeaderCell>Phone</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        <TableHeaderCell>Current properties</TableHeaderCell>
        {canManage && (
          <TableHeaderCell className="text-right">Actions</TableHeaderCell>
        )}
      </TableHead>
      <TableBody>
        {cleaners.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <span className="font-medium text-ink">{c.name}</span>
              {c.notes && (
                <p className="mt-1 text-xs text-ink-muted">{c.notes}</p>
              )}
            </TableCell>
            <TableCell className="text-ink-muted">
              <span className="whitespace-nowrap">{c.phoneDisplay}</span>
              <BackupContacts
                cleaner={c}
                canManage={canManage}
                contactActions={contactActions}
              />
            </TableCell>
            <TableCell>
              <Badge tone={c.status === "ACTIVE" ? "success" : "neutral"}>
                {c.status === "ACTIVE" ? "Active" : "Inactive"}
              </Badge>
            </TableCell>
            <TableCell className="text-ink-muted">
              {c.currentAssignments.length === 0
                ? "—"
                : c.currentAssignments
                    .map(
                      (a) =>
                        `${a.property.name}${a.role === "TEAM_MEMBER" ? " (team)" : ""}`,
                    )
                    .join(", ")}
            </TableCell>
            {canManage && (
              <TableCell>
                <div className="flex items-start justify-end gap-2">
                  <DialogTrigger
                    label="Edit"
                    title={`Edit ${c.name}`}
                    variant="secondary"
                    showIcon={false}
                  >
                    <CleanerForm cleaner={c} action={updateAction} />
                  </DialogTrigger>
                  <DialogTrigger
                    label="Add backup"
                    title={`Add backup contact for ${c.name}`}
                    variant="secondary"
                    showIcon={false}
                  >
                    <CleanerContactForm
                      cleanerId={c.id}
                      action={contactActions.add}
                    />
                  </DialogTrigger>
                  {c.status === "ACTIVE" ? (
                    <CleanerActionButton
                      action={setStatusAction}
                      fields={{ id: c.id, status: "INACTIVE" }}
                      label="Deactivate"
                      variant="danger"
                      confirmMessage={`Deactivate ${c.name}? They can't be assigned while inactive. Their history is kept.`}
                    />
                  ) : (
                    <CleanerActionButton
                      action={setStatusAction}
                      fields={{ id: c.id, status: "ACTIVE" }}
                      label="Reactivate"
                      confirmMessage={`Reactivate ${c.name}?`}
                    />
                  )}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
