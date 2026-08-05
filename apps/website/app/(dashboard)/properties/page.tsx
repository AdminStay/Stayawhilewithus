import { CreatePropertyForm } from "@/domains/properties/components/CreatePropertyForm";
import { PropertyList } from "@/domains/properties/components/PropertyList";
import { listProperties } from "@/domains/properties/services/properties.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function PropertiesPage() {
  const actor = await getCurrentUser();
  const properties = await listProperties(actor);

  return (
    <div className="space-y-8">
      <PropertyList properties={properties} />
      <CreatePropertyForm />
    </div>
  );
}
