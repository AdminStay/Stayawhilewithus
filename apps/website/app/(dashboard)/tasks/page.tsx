import { DialogTrigger, PageHeader } from "@stayw/ui";

import { listProperties } from "@/domains/properties/services/properties.service";
import { CreateTaskForm } from "@/domains/tasks/components/CreateTaskForm";
import { TaskList } from "@/domains/tasks/components/TaskList";
import {
  listAssignableUsers,
  listTasks,
} from "@/domains/tasks/services/tasks.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function TasksPage() {
  const actor = await getCurrentUser();
  const [tasks, properties, assignableUsers] = await Promise.all([
    listTasks(actor),
    listProperties(actor),
    listAssignableUsers(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} across the business`}
        actions={
          <DialogTrigger label="Add task" title="Add task">
            <CreateTaskForm properties={properties} />
          </DialogTrigger>
        }
      />
      <TaskList tasks={tasks} assignableUsers={assignableUsers} />
    </div>
  );
}
